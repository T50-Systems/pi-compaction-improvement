# Compaction architecture

`pi-compaction-improvement` improves Pi's compaction behavior as an installable extension. It does not replace Pi core compaction; it provides earlier trigger decisions and a safer `session_before_compact` summary path with fallback to Pi core whenever the extension cannot safely produce a result.

## Architectural layers

The compaction path is intentionally split into three complementary layers:

```text
Pi hooks / commands
  -> orchestration
     -> lifecycle state machine
     -> pipe-and-filter summary pipeline
     -> contract-driven verification and commit
        -> Pi-compatible compaction result
```

Each layer owns a different kind of correctness:

| Layer | Owns | Does not own |
| --- | --- | --- |
| Pipe-and-filter | The ordered work steps that transform compaction input into a candidate summary. | Semantic safety of the final summary. |
| Lifecycle state machine | Valid lifecycle transitions and phase observability. | Summary structure, size, or file preservation rules. |
| Contracts/workflow | Semantic guarantees before returning a compaction result. | How the summary was produced internally. |

This avoids duplicated rules: the state machine protects the path, while contracts protect the result.

## Entry points

### Trigger side

Implemented around `turn_end` trigger policy:

- `src/compaction/compaction-trigger.ts`
- `src/policy.ts`
- `src/compaction/scheduler.ts`
- `src/compaction/state-machine.ts`

This side decides whether to request compaction based on token usage, growth, tool-heavy turns, cooldowns, and in-flight state.

### Summary side

Implemented around `session_before_compact`:

- `src/compaction/orchestration.ts`
- `src/compaction/summary-pipeline.ts`
- `src/compaction/lifecycle-state-machine.ts`
- `src/compaction/compaction-workflow.ts`

This side receives Pi's prepared compaction slice and either returns a validated extension summary or falls back to Pi core by returning `undefined`.

## Summary orchestration

`src/compaction/orchestration.ts` is intentionally thin. Its responsibilities are:

1. Parse and validate the raw `session_before_compact` event.
2. Resolve active model and auth.
3. Build merged file lists from previous summary tags plus current file operations.
4. Build a `CompactionPlan`.
5. Run the summary pipeline.
6. Retry with aggressive mode only for retryable output-quality failures.
7. Notify and fall back to Pi core on failure.

It should not contain detailed summary production steps. Those belong in the pipeline.

## Pipe-and-filter pipeline

`src/compaction/pipeline.ts` provides the tiny generic runner:

```text
context -> filter -> filter -> filter -> context
```

`src/compaction/summary-pipeline.ts` uses it for the compaction summary path:

```text
resolveSummaryMode
  -> requestHistorySummary
  -> validateHistorySummary
  -> requestTurnPrefixSummary
  -> assembleSummaryFragments
  -> verifyAndCommitSummary
```

### Filter responsibilities

- `resolveSummaryMode`: chooses `standard`, `focused`, or `aggressive` using summary request policy.
- `requestHistorySummary`: produces the history summary, or reuses stripped previous summary when there are no history messages.
- `validateHistorySummary`: checks the generated history fragment has the required structured sections before more work continues.
- `requestTurnPrefixSummary`: summarizes split-turn prefix messages when present.
- `assembleSummaryFragments`: merges history and turn-prefix fragments and appends file operation tags.
- `verifyAndCommitSummary`: delegates semantic validation and result construction to the contract-driven workflow.

Filters should be small, ordered, and context-passing. They should not directly notify the user except through injected callbacks, and they should not duplicate contract checks.

## Lifecycle state machine

`src/compaction/lifecycle-state-machine.ts` models the internal lifecycle:

```text
idle
  -> observed
  -> authenticated
  -> planned
  -> mode-resolved
  -> history-producing
  -> history-produced
  -> history-validated
  -> turn-prefix-producing
  -> turn-prefix-produced
  -> assembled
  -> verifying
  -> committed
  -> completed
```

Terminal alternatives:

```text
skipped
failed
```

Formal definition:

```text
A = (Q, Σ, δ, q0, F)

Q  = COMPACTION_LIFECYCLE_STATES
Σ  = COMPACTION_LIFECYCLE_ALPHABET
δ  = TRANSITIONS
q0 = COMPACTION_LIFECYCLE_INITIAL_STATE = idle
F  = COMPACTION_LIFECYCLE_TERMINAL_STATES = {completed, skipped, failed}
```

The state machine is intentionally lightweight. It answers:

- Did this compaction attempt move through valid phases?
- Where did it fail or skip?
- Can lifecycle transitions be audited in tests or telemetry?

It does **not** answer:

- Is the summary structurally valid?
- Is the summary too long?
- Were file tags preserved?
- Is the returned compaction object valid?

Those are contract/workflow responsibilities.

### Lifecycle callbacks

`runSummaryAttemptPipeline()` accepts `onLifecycle`, which receives snapshots as phases advance. This gives tests and future telemetry a stable hook without coupling production code to logging.

Production orchestration uses that hook and the attempt result to retain at most 20 privacy-safe lifecycle outcomes. Each entry contains a timestamp, trigger category, terminal state (`skipped`, `failed`, `fallback`, or `completed`), duration, retry count, invariant identifiers, and a closed fallback category. The schema intentionally has no free-text payload fields, so it cannot retain prompts, transcripts, generated summaries, credentials, API keys, request headers, project identity, paths, error messages, or file contents.

Persistence is an optional infrastructure adapter in `lifecycle-diagnostic-persistence.ts`, governed by [ADR 0001](decisions/0001-opt-in-local-diagnostic-persistence.md). `persistLifecycleDiagnostics` defaults to `false`. When enabled, `session_start` validates and replaces in-memory history from the version-1 exact-allowlist envelope at `~/.pi/agent/pi-autocompact-v2-diagnostics.json`; replacement prevents duplicate append on repeated hydration. Lifecycle completion writes the newest 20 entries through a same-directory temporary file and atomic rename. `/autocompact-status clear` empties memory and best-effort deletes destination and temporary files.

The adapter is deliberately below the compaction decision/result boundary. Missing, corrupt, oversized, old, future-version, or schema-invalid files hydrate as empty. Read/write/delete failures are contained and cannot change retries, verification, returned results, or fallback to Pi core. A future schema requires an explicit migration and privacy-reviewed ADR; unknown versions are never guessed or partially recovered.

## Formal invariants

`src/compaction/invariants.ts` defines the invariant set:

```text
I = {
  valid-lifecycle-transition,
  terminal-states-are-absorbing,
  required-summary-sections-preserved,
  summary-size-bounded,
  file-lists-preserved,
  split-turn-context-preserved,
  validated-result-only
}
```

Lifecycle invariants are enforced by `transitionCompactionLifecycle()` and the terminal-state tests. Semantic invariants are enforced by `verifyCompactionSummary()` and exposed through `violatedInvariants` so fallback paths can report which contract failed. Verification issues map to invariants through `COMPACTION_VERIFICATION_ISSUE_INVARIANTS`.

## Contract-driven verification

`src/compaction/compaction-workflow.ts` owns semantic correctness:

```text
verifyCompactionSummary(plan, summary, maxTokens)
commitVerifiedCompaction(plan, summary, maxTokens)
```

The workflow validates:

- required summary structure;
- summary size limits;
- file list preservation from the plan;
- split-turn context preservation when the plan requires it;
- successful construction of a Pi-compatible compaction result.

`commitVerifiedCompaction()` is the only path that converts a candidate summary into a returned extension compaction result.

## Compaction plan

`src/compaction/compaction-plan.ts` creates a `CompactionPlan` before summary production. The plan captures the invariants the final summary must preserve:

- reason and trigger metadata;
- first kept entry;
- token count before compaction;
- message counts;
- whether split-turn context is present;
- required sections;
- merged file lists from previous and current context.

The plan is passed through the pipeline and consumed by the contract workflow.

## Failure and fallback model

The extension should prefer safe fallback over risky output. Common fallback paths:

- incompatible event;
- missing model;
- missing auth;
- provider error;
- timeout or abort;
- invalid structure;
- too-long summary;
- failed plan verification;
- invalid compaction result.

Most failures return `undefined`, allowing Pi core compaction to continue. Provider failures notify as errors; expected quality/fallback failures notify as warnings; aborts stay quiet.

Retry policy is deliberately narrow:

```text
empty | invalid-structure | too-long
  -> retry once with aggressive mode, unless already aggressive
```

## Testing map

Key tests:

- `tests/compaction-pipeline.test.ts`: generic pipe-and-filter ordering.
- `tests/compaction-summary-pipeline.test.ts`: summary pipeline assembly, commit, notifications, and lifecycle progress.
- `tests/compaction-lifecycle-state-machine.test.ts`: valid/invalid lifecycle transitions and terminal states.
- `tests/compaction-invariants.test.ts`: formal invariant catalog and issue-to-invariant mapping.
- `tests/compaction-workflow.test.ts`: contract-driven verification and commit behavior.
- `tests/extension-before-compact.test.ts`: integration through the extension hook.

## Extension guidelines

When changing compaction behavior:

1. Put new production steps in `summary-pipeline.ts` as filters.
2. Add lifecycle phases only for meaningful operational boundaries.
3. Put semantic safety checks in `compaction-workflow.ts`, not the state machine.
4. Keep `orchestration.ts` thin.
5. Preserve fallback-to-core behavior for unsafe or incomplete results.
6. Add tests at the layer that owns the behavior.

## Current validation command set

```bash
npm run typecheck
npm run test:coverage
npm run check:file-size
git diff --check
pi install .
```
