# pi-compact-tracker

Canonical compactation/resume state repo for Pi work.

This repo is **not just a tracker**.
It is intended to hold the current compactation-safe working state that Pi can read to resume active work after chat history compacts.

## What Pi should read first

Top-level active state files:
- `ACTIVE-COMPACT-STATE.json` — machine-readable current state
- `ACTIVE-COMPACT-STATE.md` — human-readable resume note
- `PROTOCOL.md` — update/read contract for future sessions

.git-tracked history plus timestamped checkpoint files under `checkpoints/` provide the durable trail.

## Purpose

Keep the current resumable state outside chat history so compactation does not erase:
- the active objective
- whether work is finished / in progress / interrupted
- the exact next step
- key files touched
- verification already completed
- known blockers / cautions

## Current repo role

This repo can still contain investigation reports and diffs, but those are now secondary.
The primary role is to be the **source of truth for active compactation state**.

## Existing analysis artifacts

- `reports/compact-surface-map.md` — compact touchpoints found in the source repo
- `reports/origin-comparison.md` — comparison against `origin/main`
- `patches/compact-vs-origin.patch` — focused diff for compact-related files

## Recommended operating rule

Before and after major work slices, update:
1. `ACTIVE-COMPACT-STATE.json`
2. `ACTIVE-COMPACT-STATE.md`
3. add a timestamped file under `checkpoints/` when the checkpoint is significant

That way Pi can resume from this repo instead of depending on volatile chat context.
