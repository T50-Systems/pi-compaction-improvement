# pi-compact-tracker

Tracking repo for `/compact` / `compaction` work extracted from `pi-gui`.

## Source repo
- Local source: `C:/Users/c___h/source/repos/pi-gui`
- Compared baseline: `origin/main` of `https://github.com/minghinmatthewlam/pi-gui.git`

## Purpose
Keep compact-specific investigation, diffs, and follow-up work isolated from the larger desktop UI stream.

## Current finding
Core compact/compaction logic is unchanged vs `origin/main` in the driver layer.
The relevant divergence is in desktop command handling:
- `apps/desktop/electron/app-store-composer.ts`
- `/compact` was changed to be visually non-blocking

## Files in this repo
- `reports/compact-surface-map.md` — all compact touchpoints found in the source repo
- `reports/origin-comparison.md` — comparison against `origin/main`
- `patches/compact-vs-origin.patch` — focused diff for compact-related files
