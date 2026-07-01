#!/usr/bin/env bash
set -euo pipefail

SOURCE_REPO="/c/dev/pi/pi-gui"
OUT_REPO="/c/dev/pi/pi-compaction-improvement"

cd "$SOURCE_REPO"
git diff --unified=3 origin/main -- \
  apps/desktop/electron/app-store-composer.ts \
  apps/desktop/src/composer-commands.ts \
  apps/desktop/src/tree-modal.tsx \
  apps/desktop/src/timeline-item.tsx \
  packages/pi-sdk-driver/src/session-supervisor.ts \
  packages/pi-sdk-driver/src/session-supervisor-utils.ts \
  packages/pi-sdk-driver/src/transcript.ts \
  packages/session-driver/src/types.ts \
  > "$OUT_REPO/patches/compact-vs-origin.patch"

echo "Refreshed $OUT_REPO/patches/compact-vs-origin.patch"
