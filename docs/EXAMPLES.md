# Examples and Recovery Recipes

## Inspect current state

```text
/autocompact-status
```

Use this before changing configuration. It reports whether autocompaction is enabled, thresholds, current lifecycle state, and recent trigger/recovery information.

## Run a manual compaction

```text
/autocompact-now Preserve the active goal, exact files changed, verification results, and the next executable action.
```

The extension validates the generated summary and returns control to Pi core when it cannot safely commit a result.

## Tune project configuration

```text
/autocompact-config project
/autocompact-config project softBufferTokens 32000
/autocompact-config project minTurnsBetweenCompacts 3
```

Prefer project scope for repository-specific tuning. Use `/autocompact-config project reset` to recover defaults.

## Diagnose repeated compaction

1. Run `/autocompact-status` and inspect the last trigger reason.
2. Check cooldown, rapid/sustained growth, tool-heavy, and emergency thresholds.
3. Use `/autocompact-off` to pause automatic triggers while investigating.
4. Reset project configuration if values are invalid or stale.

## Validate a checkout

```bash
npm run typecheck
npm test
npm run check:file-size
npm run benchmark
```
