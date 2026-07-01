# Checkpoint — 2026-07-01 — Settings refactor

## Status
- in progress
- interrupted by compaction before completion

## Active work
Refactor `pi-gui` Settings from a generic/evolved `SecondarySurface` shell toward a dedicated Settings sidebar and surface.

## Linked local work
- Source repo: `C:/dev/pi/pi-gui`
- Companion state repo: `C:/dev/pi/pi-compaction-improvement`

## Already completed before interruption
- persisted agent visible narration preferences
- applied those preferences to session instructions for new and reopened sessions
- improved the `Agent visible narration` Settings panel UI
- added search/groups/icons to the current Settings nav
- fixed scroll so the left Settings pane stays fixed while only the right pane scrolls
- validated those slices with `cd apps/desktop && pnpm build`

## Next step
Replace the current Settings shell with a dedicated sidebar structure and more product-like layout/taxonomy.

## Primary files
- `apps/desktop/src/secondary-surface.tsx`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/settings-view.tsx`
- `apps/desktop/src/styles/main.css`

## Resume note
Do not claim the Settings redesign complete yet.
The compaction mitigation work is in place; the product refactor itself still needs implementation.
