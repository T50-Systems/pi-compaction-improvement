# pi-compaction-improvement

Installable Pi package that improves automatic compaction without replacing Pi core compaction.

## What it does

- Proactively requests compaction from `turn_end` before the hard context limit.
- Triggers on soft threshold, rapid growth, sustained growth, tool-heavy turns, and near-limit emergency band.
- Uses cooldown and in-flight guards to avoid repeated or overlapping compactions.
- Produces richer `session_before_compact` summaries when model/auth are available.
- Preserves structured goal/progress/context sections and file tracking tags.
- Falls back to Pi core compaction whenever the extension cannot safely produce a validated result.
- Provides manual commands such as `/autocompact-now`, `/autocompact-status`, and `/autocompact-config`.

## Install in Pi

```bash
pi install git:github.com/T50-Systems/pi-compaction-improvement@main
```

For local development:

```bash
pi install .
```

## Architecture

The compaction summary path is split into complementary layers:

```text
Pi hooks / commands
  -> orchestration
     -> lifecycle state machine
     -> pipe-and-filter summary pipeline
     -> contract-driven verification and commit
        -> Pi-compatible compaction result
```

Key files:

- `src/compaction/orchestration.ts` — thin `session_before_compact` coordinator: parse event, resolve model/auth, build plan, run pipeline, handle fallback.
- `src/compaction/pipeline.ts` — generic pipe-and-filter runner.
- `src/compaction/summary-pipeline.ts` — ordered summary filters: mode resolution, history summary, validation, turn-prefix summary, assembly, verification/commit.
- `src/compaction/lifecycle-state-machine.ts` — lifecycle transitions for observability and phase safety.
- `src/compaction/compaction-plan.ts` — plan of what the final summary must preserve.
- `src/compaction/compaction-workflow.ts` — contract-driven verification before returning a compaction result.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full architecture guide.

## Design principles

- **Pipe-and-filter does the work:** each filter performs one summary production step and passes context forward.
- **State machine guards lifecycle:** it tracks valid internal phases such as `planned`, `history-producing`, `assembled`, `verifying`, and `completed`.
- **Contracts guard semantics:** final summaries must preserve required sections, file tags, split-turn context, and size limits before commit.
- **Fallback is safer than risky output:** invalid, missing, too-large, or unverifiable summaries return `undefined` so Pi core can compact normally.

## Commands

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

## Validation

```bash
npm run typecheck
npm test
npm run check:file-size
git diff --check
pi install .
```

## Scope

This repo is an installable Pi package. It does not act as a durable external state or context sync system, and it does not patch Pi core's compaction cut-point algorithm.
