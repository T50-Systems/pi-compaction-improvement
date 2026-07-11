# Product Vision and Success Metrics

## Vision

Make Pi compaction proactive, context-preserving, observable, and safe without replacing Pi core.

## Product promise

Long sessions compact before hard limits while preserving goals, progress, files, split-turn context, and the next executable action. Invalid extension summaries always fall back to Pi core.

## Success metrics

| ID | Outcome | Target | Evidence |
|---|---|---|---|
| SAFE-1 | Invalid or unverifiable summaries returned | 0 | contract/workflow tests |
| REL-1 | Duplicate or overlapping compactions | 0 known; 100% guard pass | scheduler/lifecycle tests |
| REL-2 | Required context preserved | 100% invariant pass | summary/invariant tests |
| PERF-1 | Local policy decision overhead | p99 < 5 ms | `npm run benchmark` |
| UX-1 | Classified failures have recovery/fallback | 100% | command/status tests and docs |

Targets are validated locally and in CI. The extension does not collect remote usage telemetry.
