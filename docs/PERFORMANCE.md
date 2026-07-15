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

## 3. Hosted-runner evidence and SLO decisions

CI runs `npm run benchmark:hosted` five times for every supported hosted-runner and Node combination: Ubuntu, Windows, and macOS on Node 22 and 24. Each repetition starts separate Vitest summary-profile and policy-benchmark processes. The fixtures and sample counts stay fixed; elapsed time and memory observations are measurements and therefore vary with runner scheduling.

Each matrix cell uploads only:

- `hosted-benchmark-results.json`, validated against `scripts/schemas/hosted-benchmark-results.schema.json`; and
- `hosted-benchmark.log`, reconstructed from the same allowlisted numeric records.

The evidence records the runner label, OS release, architecture, Node version, Vitest version, repository commit, workflow run ID/attempt, repetition count, `SUMMARY_PROFILE`, `SUMMARY_MEMORY`, `SUMMARY_POLICY`, `SUMMARY_REGRESSION_POLICY`, normalized policy benchmark numbers, and the existing PERF-1 policy result. The closed schema rejects extra fields. The collector never writes environment dumps, prompts, transcripts, generated summaries, credentials, request headers, or raw provider output, and it never calls a real provider.

### Measurement versus SLO decision

The hosted evidence job is a measurement gate, not permission to choose a tighter SLO. Issue #37 follows this sequence:

1. Collect all five successful repetitions for every OS/Node matrix cell. A missing artifact, failed 250 ms safety check, schema failure, or mixed/missing runtime metadata invalidates that cell.
2. Review each matrix cell separately before considering an aggregate. For the complete, timeout, and abort paths, compare the distribution of per-repetition p99 values, including the median, upper tail, maximum, and run-to-run spread. Do not hide a slow runner by pooling it with faster runners.
3. Check memory deltas and policy results for instability, but do not turn endpoint memory observations into a peak-memory budget.
4. If the hosted distributions are sparse, multimodal, dominated by runner noise, or lack clear headroom, retain the broad 250 ms non-network safety bound and record why. Retention is a valid evidence-based decision.
5. Only if every supported cell is stable may maintainers propose a conservative tighter regression budget. The proposal must cite hosted run/artifact URLs, state how headroom was derived from the slowest observed cell, preserve protection against hangs/external calls, and include rollback criteria. No candidate value is selected in the measurement change.

A conclusion to retain 250 ms can be documented with the evidence change. Any numerical tightening should be a second budget-decision pull request created after the hosted measurement pull request has produced complete artifacts, so the decision is reviewable independently from the harness that generated its evidence.

### Initial hosted decision

[GitHub Actions run 29458769458](https://github.com/T50-Systems/pi-compaction-improvement/actions/runs/29458769458) measured commit `c6b2bb7` from measurement PR #41. All six matrix cells produced five schema-valid repetitions (30 total), and every 250 ms safety and PERF-1 policy result passed.

| Runner / Node | Complete p99 max | Timeout p99 max | Abort p99 max |
|---|---:|---:|---:|
| macOS / 22 | 2.2582 ms | 0.1322 ms | 0.1089 ms |
| macOS / 24 | 1.7840 ms | 0.2280 ms | 0.3777 ms |
| Ubuntu / 22 | 2.9879 ms | 0.1929 ms | 0.1301 ms |
| Ubuntu / 24 | 2.3422 ms | 0.5925 ms | 0.1981 ms |
| Windows / 22 | 3.4443 ms | 0.1436 ms | 0.2090 ms |
| Windows / 24 | 5.1385 ms | 0.8075 ms | 0.2429 ms |

The slowest observed complete-pipeline p99 was 5.1385 ms. Multiplying that maximum by four gives 20.554 ms; rounding upward to the next 5 ms boundary produces a conservative 25 ms regression budget. This leaves approximately 4.86x headroom over the slowest observed cell and substantially more for timeout and abort paths.

The benchmark therefore enforces two separate policies: `SUMMARY_POLICY` retains the 250 ms hang/external-call safety bound, while `SUMMARY_REGRESSION_POLICY` enforces the evidence-derived 25 ms budget. The latter is a CI regression threshold, not a real-provider or end-user latency SLO. Roll back to measurement-only enforcement if two independent hosted runs exceed 25 ms without a corresponding code regression; otherwise treat an exceedance as a regression to investigate. Endpoint memory deltas remain observations only.

## 4. Real-provider observations

Real-provider latency is intentionally outside CI and this benchmark because it includes network transit, provider queueing, model generation, authentication, and rate limits. When collecting an operator observation:

1. record provider/model, region, Node/OS, input size, output size, and sample count;
2. never record prompts, transcripts, summaries, API keys, or request headers;
3. report provider latency separately from the extension-owned fake-provider profile; and
4. do not convert one provider sample into a package regression threshold.

No real-provider observation is required for package validation.
