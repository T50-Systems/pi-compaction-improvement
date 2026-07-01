# Comparison against original project (`origin/main`)

## Result
Compact-specific core behavior is effectively the same as the original project in the shared driver/packages layer.

## Unchanged vs origin/main
These compact-related files exist in `origin/main` and did not show compact-specific divergence in the current comparison:
- `apps/desktop/src/composer-commands.ts`
- `packages/session-driver/src/types.ts`
- `packages/pi-sdk-driver/src/pi-sdk-driver.ts`
- `packages/pi-sdk-driver/src/session-supervisor.ts`
- `packages/pi-sdk-driver/src/session-supervisor-utils.ts`
- `packages/pi-sdk-driver/src/transcript.ts`
- `apps/desktop/src/tree-modal.tsx` (changed overall, but not for compact semantics)

## Meaningful difference found
### `apps/desktop/electron/app-store-composer.ts`
Original behavior:
- `/compact` awaited `store.driver.compactSession(...)`
- then awaited `store.reloadTranscriptFromDriver(...)`
- only then returned `Compacted session context`

Current behavior:
- `/compact` returns immediately with `Compacting session context…`
- actual compaction runs in background via `compactSessionInBackground(...)`
- completion appends `Compacted session context`
- failure appends `Compaction failed · ...`

## Why this matters
This is the main compact-specific delta currently identified against the original project:
- original: blocking UI path
- current: non-blocking visual path

## Non-compact noise also present
Other current diffs against `origin/main` include broader UI refactors, especially:
- `apps/desktop/src/timeline-item.tsx`
- `apps/desktop/src/tree-modal.tsx`

Those should not be treated as compact-core changes.
