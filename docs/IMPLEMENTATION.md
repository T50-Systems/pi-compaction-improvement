# Implementation notes

`pi-autocompact-v2` now implements the full extension-side roadmap that can work in the current pi install here.

## Trigger side (`when`)

Implemented in `extensions/index.ts` + `src/policy.ts`:

- proactive trigger on `turn_end`
- soft threshold before pi core's hard threshold
- rapid growth trigger
- sustained growth trigger
- tool-heavy turn trigger
- emergency near-limit trigger
- cooldown / hysteresis guard
- in-flight guard
- runtime status line
- manual control commands
- global + project config files
- disabled-default, local-only lifecycle diagnostic persistence

## Summary side (`how`)

Implemented in `extensions/index.ts` + `src/prompt.ts` + `src/file-tags.ts`:

- improved structured summary template
- directive-aware standard/focused/aggressive summary modes
- preserved `previousSummary`
- preserved split-turn behavior
- preserved and merged file tracking tags
- fallback to pi core summary on missing model/auth or extension failure

## Command surface

- `/autocompact-status`
- `/autocompact-status clear`
- `/autocompact-now [instructions]`
- `/autocompact-on`
- `/autocompact-off`
- `/autocompact-config`
- `/autocompact-config project`
- `/autocompact-config [global|project] reset`
- `/autocompact-config [global|project] path`
- `/autocompact-config global <key> <value>`

## Diagnostic persistence

Set `persistLifecycleDiagnostics` with `/autocompact-config global persistLifecycleDiagnostics true` to opt in. The effective global/project configuration controls the feature, while the store remains machine-scoped at `~/.pi/agent/pi-autocompact-v2-diagnostics.json` so it cannot be accidentally committed with a project.

`extensions/index.ts` hydrates by replacement on `session_start` and flushes after `session_before_compact` completes. `status-command-handlers.ts` clears both memory and durable state. `lifecycle-diagnostic-persistence.ts` owns the version-1 exact-allowlist parser, newest-20 retention, 64 KiB input bound, same-directory temporary write/rename, and best-effort failure containment. Unsupported old/future versions and corrupt data load as empty; no migration exists before version 1. See [ADR 0001](decisions/0001-opt-in-local-diagnostic-persistence.md).

## Validation

Covered by unit tests for:

- policy decisions
- config normalization/parsing
- prompt generation
- file tag handling
- tool-result size estimation
- persistence schema, corruption/version behavior, atomic replacement, durable clear, hydration, and failure isolation

## Architecture reference

The current summary path is documented in [`ARCHITECTURE.md`](ARCHITECTURE.md). In short: `orchestration.ts` handles event/auth/plan setup, `summary-pipeline.ts` runs the pipe-and-filter production path, `lifecycle-state-machine.ts` guards phase transitions, and `compaction-workflow.ts` owns contract verification before returning a compaction result.
