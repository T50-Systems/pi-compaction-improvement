import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { buildCompactionPlan } from "../src/compaction/compaction-plan.ts";
import { commitVerifiedCompaction } from "../src/compaction/compaction-workflow.ts";
import { formatFileOperations } from "../src/file-tags.ts";
import { runSummaryAttemptPipeline } from "../src/compaction/summary-pipeline.ts";
import type { SummaryProviderResult } from "../src/compaction/summary-provider.ts";
import { createInitialState } from "../src/state.ts";

const SUMMARY = `## Goal
Continue the benchmark safely.

## Progress
### Done
- [x] Built deterministic fixtures.
### In Progress
- [ ] Measure the pipeline.
### Blocked
- None.

## Immediate Next Action
1. Record percentile output.

## Continuation Contract
- Resume automatically after compaction: yes
- If no, ask the user exactly this: N/A

## Critical Context
- Fake providers perform no network calls.`;

interface Percentiles {
	p50Ms: number;
	p95Ms: number;
	p99Ms: number;
	samples: number;
}

function percentile(sorted: readonly number[], quantile: number): number {
	return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}

function summarize(samples: number[]): Percentiles {
	const sorted = [...samples].sort((left, right) => left - right);
	return {
		p50Ms: percentile(sorted, 0.5),
		p95Ms: percentile(sorted, 0.95),
		p99Ms: percentile(sorted, 0.99),
		samples: sorted.length,
	};
}

async function measureAsync(samples: number, operation: () => Promise<unknown>): Promise<Percentiles> {
	const durations: number[] = [];
	for (let index = 0; index < samples; index += 1) {
		const startedAt = performance.now();
		await operation();
		durations.push(performance.now() - startedAt);
	}
	return summarize(durations);
}

function measureSync(samples: number, operation: () => unknown): Percentiles {
	const durations: number[] = [];
	for (let index = 0; index < samples; index += 1) {
		const startedAt = performance.now();
		operation();
		durations.push(performance.now() - startedAt);
	}
	return summarize(durations);
}

function fixture(messageCount: number) {
	const preparation = {
		messagesToSummarize: Array.from({ length: messageCount }, (_, index) => ({
			role: index % 2 === 0 ? "user" : "assistant",
			content: [{ type: "text", text: `fixture message ${index} with bounded deterministic content` }],
		})),
		turnPrefixMessages: [],
		firstKeptEntryId: "entry-1",
		tokensBefore: Math.max(10_000, messageCount * 12),
		previousSummary: undefined,
		fileOps: { read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() },
		settings: { reserveTokens: 8_192 },
	};
	const fileLists = { readFiles: ["src/compaction/summary-pipeline.ts"], modifiedFiles: [] };
	const state = createInitialState();
	const plan = buildCompactionPlan({
		preparation,
		state,
		reason: "threshold",
		willRetry: false,
		fileLists,
		now: 1,
	});
	return { preparation, fileLists, state, plan };
}

function pipelineOperation(
	messageCount: number,
	providerResult: SummaryProviderResult,
	forceMode?: "aggressive",
	signal?: AbortSignal,
) {
	const input = fixture(messageCount);
	return () =>
		runSummaryAttemptPipeline({
			...input,
			reason: "threshold",
			willRetry: false,
			model: { provider: "fake", id: "deterministic", maxTokens: 8_192 } as never,
			auth: { apiKey: "fixture-only" },
			forceMode,
			signal,
			summaryProvider: async () => providerResult,
		});
}

describe("deterministic summary-generation performance profile", () => {
	it("reports assembly, verification, and fake-provider fallback percentiles", async () => {
		const representative = fixture(40);
		const assembledSummary = `${SUMMARY}${formatFileOperations(representative.fileLists.readFiles, representative.fileLists.modifiedFiles)}`;
		const assembly = measureSync(1_000, () =>
			`${SUMMARY}${formatFileOperations(representative.fileLists.readFiles, representative.fileLists.modifiedFiles)}`,
		);
		const verification = measureSync(1_000, () =>
			commitVerifiedCompaction({ plan: representative.plan, summary: assembledSummary, maxTokens: 2_048 }),
		);
		const complete = await measureAsync(
			40,
			pipelineOperation(40, { ok: true, summary: SUMMARY }),
		);
		const aggressive = await measureAsync(
			40,
			pipelineOperation(40, { ok: true, summary: SUMMARY }, "aggressive"),
		);
		const invalidFallback = await measureAsync(
			40,
			pipelineOperation(40, { ok: true, summary: "invalid summary" }),
		);
		const timeoutFallback = await measureAsync(
			40,
			pipelineOperation(40, { ok: false, reason: "timeout" }),
		);
		const controller = new AbortController();
		controller.abort();
		const abortFallback = await measureAsync(
			40,
			pipelineOperation(40, { ok: false, reason: "aborted" }, undefined, controller.signal),
		);

		const report = { assembly, verification, complete, aggressive, invalidFallback, timeoutFallback, abortFallback };
		console.log(`SUMMARY_PROFILE ${JSON.stringify(report)}`);
		expect(timeoutFallback.p99Ms).toBeLessThan(250);
		expect(abortFallback.p99Ms).toBeLessThan(250);
		expect(complete.p99Ms).toBeLessThan(250);
	});

	it("records representative and near-context-limit memory observations", async () => {
		const observe = async (label: string, messageCount: number) => {
			const before = process.memoryUsage();
			await pipelineOperation(messageCount, { ok: true, summary: SUMMARY })();
			const after = process.memoryUsage();
			return {
				label,
				messageCount,
				heapUsedBeforeBytes: before.heapUsed,
				heapUsedAfterBytes: after.heapUsed,
				heapDeltaBytes: after.heapUsed - before.heapUsed,
				observedPeakHeapBytes: Math.max(before.heapUsed, after.heapUsed),
				rssBeforeBytes: before.rss,
				rssAfterBytes: after.rss,
				rssDeltaBytes: after.rss - before.rss,
				observedPeakRssBytes: Math.max(before.rss, after.rss),
			};
		};
		const memory = [
			await observe("representative", 40),
			await observe("near-context-limit", 10_000),
		];
		console.log(`SUMMARY_MEMORY ${JSON.stringify(memory)}`);
		expect(memory).toHaveLength(2);
		expect(memory.every((entry) => Number.isFinite(entry.heapUsedAfterBytes))).toBe(true);
	});
});
