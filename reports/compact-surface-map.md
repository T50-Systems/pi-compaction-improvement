# Compact surface map

## Desktop trigger
- `apps/desktop/src/composer-commands.ts`
  - exposes `/compact`
  - parses optional custom instructions
- `apps/desktop/electron/app-store-composer.ts`
  - handles `parsed.type === "compact"`
  - calls `store.driver.compactSession(...)`
  - now schedules background compaction work

## Driver API
- `packages/session-driver/src/types.ts`
  - `compactSession(sessionRef, customInstructions?)`
- `packages/pi-sdk-driver/src/pi-sdk-driver.ts`
  - forwards to supervisor
- `packages/pi-sdk-driver/src/session-supervisor.ts`
  - `compactSession(...)`
  - calls `record.session.compact(customInstructions)`

## Transcript / rendering
- `packages/pi-sdk-driver/src/transcript.ts`
  - includes role `compactionSummary`
- `packages/pi-sdk-driver/src/session-supervisor-utils.ts`
  - treats `compactionSummary` like transcript text
- `apps/desktop/src/timeline-item.tsx`
  - renders `compactionSummary` with summary-card path
- `apps/desktop/src/tree-modal.tsx`
  - shows `[compaction]` / `[compaction: ...]`

## Practical implication
The heavy work is not in the desktop command parser itself.
The expensive path is:
1. `/compact`
2. `store.driver.compactSession(...)`
3. transcript refresh / re-publication
