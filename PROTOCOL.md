# Compact state protocol

This repo is the canonical source of compactation-safe working state.

## Read order
1. `ACTIVE-COMPACT-STATE.json`
2. `ACTIVE-COMPACT-STATE.md`
3. the latest relevant file under `checkpoints/`
4. supporting reports under `reports/` if deeper context is needed

## Minimum checkpoint contents
Every active checkpoint should capture:
- objective / current work summary
- status: `finished` | `in_progress` | `interrupted`
- whether compactation interrupted the last slice
- exact next step
- key files
- last verification run
- blockers / cautions

## Update rule
Before and after any major refactor or debugging slice:
- update `ACTIVE-COMPACT-STATE.json`
- update `ACTIVE-COMPACT-STATE.md`
- optionally add a timestamped checkpoint file when the change is significant

## Compatibility goal
The format is intentionally simple so a coding agent can recover context by reading plain Markdown or JSON from Git.

## Important distinction
This repo is **not merely a tracker**.
It is meant to be the active, durable resume point for Pi after chat compactation.
