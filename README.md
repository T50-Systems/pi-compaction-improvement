# pi-compaction-improvement

Compaction improvement package and state repo for Pi.

This repo now serves **two purposes**:
1. a real Pi package that improves compaction behavior
2. a durable compaction/resume state repo for recovering work after chat compaction

## Package role
This package is the successor path for the functionality originally coming from:
- `git:github.com/cervantesh/pi-autocompact-v2@v0.2.0`

It improves both:
- **when** Pi compacts: proactive policy on `turn_end`
- **how** Pi summarizes: richer `session_before_compact` summary output

### What it changes
- proactive trigger on soft threshold, rapid growth, sustained growth, tool-heavy turns, and near-limit emergency band
- cooldown and in-flight safety guards
- richer structured summaries with preserved paths, commands, files, risks, and next actions
- manual commands such as `/autocompact-now`, `/autocompact-status`, and `/autocompact-config`

### Install in Pi
```bash
pi install git:github.com/T50-Systems/pi-compaction-improvement@main
```

## State repo role
Top-level active state files:
- `ACTIVE-COMPACT-STATE.json`
- `ACTIVE-COMPACT-STATE.md`
- `PROTOCOL.md`

These keep the compaction-safe working state outside chat history.

## Linked local work
- Active source repo: `C:/dev/pi/pi-gui`
- Local companion repo: `C:/dev/pi/pi-compaction-improvement`

## Reports and checkpoints
- `reports/` — investigation and comparison artifacts
- `checkpoints/` — timestamped resume checkpoints

## Important distinction
This repo is no longer only a tracker.
It is both:
- an installable Pi package for compaction improvement
- the source of truth for active compaction state
