# Performance Baselines

Run every non-network benchmark from a clean checkout with:

```bash
npm ci
npm run benchmark
```

The command runs two deliberately separate harnesses. Neither sends requests to a real model provider.

## 1. Pure trigger policy

`benchmarks/policy.bench.ts` isolates extension-owned threshold and trigger decisions. It excludes model/provider latency, summary generation, Pi host scheduling, and filesystem operations.

Initial local result (2026-07-11, Windows, Node 24.18.0, Vitest 4.1.9):

| Fixture | Mean | p99 | Samples |
|---|---:|---:|---:|
| Normal growth decision | 0.0001 ms | 0.0001 ms | 8,731,818 |
| Emergency decision | 0.0002 ms | 0.0004 ms | 2,653,293 |

These pure-policy fixtures are comfortably below the PERF-1 target of 5 ms p99.

## 2. Deterministic fake-provider pipeline

`benchmarks/summary-profile.ts` injects a deterministic provider into the real summary pipeline. The fixtures cover normal completion, forced aggressive mode, invalid-summary fallback, provider timeout, and caller abort. Injection avoids network, authentication, rate-limit, and provider scheduling noise while retaining extension-owned prompt assembly, lifecycle transitions, structure checks, contract verification, and fallback mapping.

The harness prints machine-readable `SUMMARY_PROFILE` JSON with p50/p95/p99 for:

- summary/file-tag assembly;
- contract verification and commit;
- the complete successful fake-provider pipeline;
- aggressive mode;
- invalid-summary fallback;
- timeout fallback; and
- abort fallback.

Timeout and abort providers return deterministic classified results rather than sleeping. Their p99, and the normal complete pipeline p99, must remain below the broad 250 ms non-network safety bound. This intentionally loose bound catches hangs or accidental external calls; it is not a production latency SLO. Tighten it only after repeated samples on the supported hosted runners.

Representative local output (2026-07-11, Windows, Node 24.18.0, Vitest 4.1.9):

| Path | p50 | p95 | p99 | Samples |
|---|---:|---:|---:|---:|
| Assembly | 0.0004 ms | 0.0005 ms | 0.0051 ms | 1,000 |
| Verification | 0.0116 ms | 0.0177 ms | 0.0318 ms | 1,000 |
| Complete pipeline | 0.1054 ms | 0.2386 ms | 1.7516 ms | 40 |
| Aggressive mode | 0.0970 ms | 0.1233 ms | 0.1322 ms | 40 |
| Invalid-summary fallback | 0.0566 ms | 0.1071 ms | 1.8962 ms | 40 |
| Timeout fallback | 0.0437 ms | 0.0570 ms | 0.0805 ms | 40 |
| Abort fallback | 0.0446 ms | 0.0640 ms | 0.1301 ms | 40 |

Numbers vary with CPU scheduling and runtime warmup. Compare repeated runs, not a single sample.

## Memory observations

The fake-provider profile also prints `SUMMARY_MEMORY` JSON for:

- a representative 40-message history; and
- a 10,000-message, approximately 120,000-token near-context-limit history.

Each record includes heap and RSS before/after values, observed endpoint peaks, and deltas. This is allocation/retention evidence, not a precise process-wide peak profiler: V8 garbage collection and concurrent runtime allocations can move the values. A local representative run retained about 0.18 MB heap; the earlier 2,000-message calibration retained about 5.6 MB heap. Always use the current command output for the 10,000-message fixture rather than treating those calibration numbers as a budget.

## 3. Real-provider observations

Real-provider latency is intentionally outside CI and this benchmark because it includes network transit, provider queueing, model generation, authentication, and rate limits. When collecting an operator observation:

1. record provider/model, region, Node/OS, input size, output size, and sample count;
2. never record prompts, transcripts, summaries, API keys, or request headers;
3. report provider latency separately from the extension-owned fake-provider profile; and
4. do not convert one provider sample into a package regression threshold.

No real-provider observation is required for package validation.
