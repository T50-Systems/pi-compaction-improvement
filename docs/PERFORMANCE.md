# Performance Baseline

Run the pure policy benchmark with:

```bash
npm run benchmark
```

The fixture isolates extension-owned threshold and trigger decisions. It excludes model/provider latency, summary generation, Pi host scheduling, and filesystem operations.

## Initial local result

Measured 2026-07-11 on Windows with Node 24.18.0 and Vitest 4.1.9:

| Fixture | Mean | p99 | Samples |
|---|---:|---:|---:|
| Normal growth decision | 0.0001 ms | 0.0001 ms | 8,731,818 |
| Emergency decision | 0.0002 ms | 0.0004 ms | 2,653,293 |

Both pure-policy fixtures are comfortably below the 5 ms target. This is a local policy baseline, not a summary-generation or end-to-end compaction SLO.

The initial target in [`PRODUCT.md`](PRODUCT.md) is p99 below 5 ms. Record Node, Vitest, OS, sample count, mean, and percentile before publishing results. Keep this benchmark informational until a stable CI-runner baseline is established.
