# pi-compaction-improvement

Installable Pi package that improves automatic compaction behavior without replacing Pi core compaction.

`pi-compaction-improvement` adds proactive autocompaction triggers, richer compaction summaries, validation contracts, status/config commands, and safe fallback to Pi core when the extension cannot produce a verified result.

## Product vision

Make Pi compaction proactive, context-preserving, observable, and safe without replacing Pi core. See [`docs/PRODUCT.md`](docs/PRODUCT.md) for the product promise and measurable success targets.

## What it does

- Requests compaction from `turn_end` before the hard context limit is reached.
- Triggers on soft threshold, rapid growth, sustained growth, tool-heavy turns, and near-limit emergency bands.
- Uses cooldown and in-flight guards to avoid repeated or overlapping compactions.
- Produces richer `session_before_compact` summaries when model/auth context is available.
- Preserves structured goal/progress/context sections and file tracking tags.
- Verifies summaries against required sections, size limits, split-turn context, and file-tag expectations.
- Falls back to Pi core compaction by returning `undefined` whenever output is missing, invalid, oversized, or unverifiable.
- Provides manual status/config/compact commands.

## Commands

```text
/autocompact-status
/autocompact-status clear
/autocompact-now [instructions]
/autocompact-on
/autocompact-off
/autocompact-config
/autocompact-config project
/autocompact-config [global|project] reset
/autocompact-config [global|project] path
/autocompact-config global <key> <value>
```

`/autocompact-status` includes the newest-first, bounded lifecycle diagnostic history. `/autocompact-status clear` removes both that history and the status widget. Diagnostics include only trigger category, terminal state, duration, retry count, invariant identifiers, and fallback category—never prompts, summaries, file contents, headers, tokens, or credentials.

## Architecture

The compaction path is split into small, testable layers:

```text
Pi hooks / commands
  -> orchestration
     -> lifecycle state machine
     -> pipe-and-filter summary pipeline
     -> contract-driven verification and commit
        -> Pi-compatible compaction result or safe fallback
```

Key files:

- `extensions/index.ts` — Pi extension entrypoint.
- `src/compaction/orchestration.ts` — `session_before_compact` coordinator.
- `src/compaction/pipeline.ts` — generic pipe-and-filter runner.
- `src/compaction/summary-pipeline.ts` — ordered summary filters.
- `src/compaction/lifecycle-state-machine.ts` — lifecycle transitions and observability.
- `src/compaction/compaction-plan.ts` — preservation plan for final summaries.
- `src/compaction/compaction-workflow.ts` — verification before returning a result.
- `src/config.ts` / `src/policy.ts` — configuration and trigger policy.
- `src/file-tags.ts` / `src/tool-results.ts` — summary preservation helpers.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full architecture guide.

## Design principles

- **Pipe-and-filter does the work:** each filter performs one summary step and passes context forward.
- **State machine guards lifecycle:** phases such as `planned`, `history-producing`, `assembled`, `verifying`, and `completed` are explicit.
- **Contracts guard semantics:** final summaries must preserve required sections, file tags, split-turn context, and size limits.
- **Fallback is safer than risky output:** Pi core compaction takes over whenever validation fails.

## Quickstart

### 1. Install

```bash
pi install git:github.com/T50-Systems/pi-compaction-improvement@main
```

Restart Pi or run `/reload` after installation.

### 2. Inspect the active policy

```text
/autocompact-status
```

### 3. Run a bounded manual check

```text
/autocompact-now Preserve the active objective, concrete progress, exact files, verification results, and the next executable action.
```

### 4. Tune only when needed

```text
/autocompact-config project
```

For local development:

```bash
git clone https://github.com/T50-Systems/pi-compaction-improvement
cd pi-compaction-improvement
pi install .
```

## Troubleshooting

### Commands are unavailable

Confirm installation with `pi list`, restart Pi or run `/reload`, and remove stale duplicate package entries.

### Compaction triggers too often

Run `/autocompact-status` and inspect the trigger reason and cooldown. Use `/autocompact-off` while investigating, or reset project configuration with `/autocompact-config project reset`.

### A generated summary is rejected

This is the safe fallback path: the extension returns control to Pi core when structure, size, split-turn context, or file-tag contracts fail. Enable debug/status output and run the focused tests before weakening a contract.

### Session context appears incomplete after compaction

Inspect the summary for goal/progress, constraints, files, blockers, and the immediate next action. Reproduce with `/autocompact-now`, then report the before/after summary without credentials or private transcript data.

## Validation

```bash
npm install
npm run typecheck
npm run test:coverage
npm run check:file-size
git diff --check
pi install .
```

## Scope

This repository is an installable Pi extension package. It does not provide durable external context sync, and it does not patch Pi core's compaction cut-point algorithm.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — architecture guide.
- [`docs/DESIGN.md`](docs/DESIGN.md) — design notes.
- [`docs/EXAMPLES.md`](docs/EXAMPLES.md) — commands and recovery recipes.
- [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md) — implementation details.
- [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) — reproducible policy benchmark.
- [`docs/PRODUCT.md`](docs/PRODUCT.md) — product vision and success metrics.
- [`reports/roadmap.md`](reports/roadmap.md) — follow-up roadmap.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — contributor workflow.
- [`SECURITY.md`](SECURITY.md) — private reporting and compaction trust boundaries.
- [`CHANGELOG.md`](CHANGELOG.md) — release history.

## License

MIT
