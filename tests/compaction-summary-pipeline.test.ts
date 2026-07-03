import { describe, expect, it, vi } from "vitest";
import { buildCompactionPlan } from "../src/compaction/compaction-plan.ts";
import { runSummaryAttemptPipeline } from "../src/compaction/summary-pipeline.ts";
import { createInitialState } from "../src/state.ts";

const SUMMARY = `## Goal
Continue safely.

## Progress
### Done
- [x] Preserved prior context.

### In Progress
- [ ] Continue.

### Blocked
- None.

## Immediate Next Action
1. Continue.

## Continuation Contract
- Resume automatically after compaction: yes
- If no, ask the user exactly this: N/A

## Critical Context
- src/compaction/summary-pipeline.ts`;

function makePreparation() {
	return {
		messagesToSummarize: [],
		turnPrefixMessages: [],
		firstKeptEntryId: "entry-1",
		tokensBefore: 1000,
		previousSummary: SUMMARY,
		fileOps: {
			read: new Set<string>(),
			written: new Set<string>(),
			edited: new Set<string>(),
		},
		settings: { reserveTokens: 2048 },
	};
}

describe("summary pipe-and-filter pipeline", () => {
	it("assembles and commits a deterministic prior-history summary", async () => {
		const preparation = makePreparation();
		const fileLists = {
			readFiles: ["src/compaction/summary-pipeline.ts"],
			modifiedFiles: [],
		};
		const plan = buildCompactionPlan({
			preparation,
			state: createInitialState(),
			reason: "threshold",
			willRetry: false,
			fileLists,
			now: 1,
		});
		const onNotify = vi.fn();
		const lifecycleStatuses: string[] = [];

		const result = await runSummaryAttemptPipeline({
			preparation,
			state: createInitialState(),
			plan,
			fileLists,
			reason: "threshold",
			willRetry: false,
			model: { provider: "test", id: "model", maxTokens: 4096 } as never,
			auth: { apiKey: "key" },
			onNotify,
			onLifecycle: (snapshot) => lifecycleStatuses.push(snapshot.status),
		});

		expect(result).toEqual({
			ok: true,
			mode: "standard",
			compaction: {
				compaction: expect.objectContaining({
					firstKeptEntryId: "entry-1",
					details: fileLists,
					summary: expect.stringContaining("<read-files>"),
				}),
			},
		});
		expect(onNotify).toHaveBeenCalledWith(
			expect.stringContaining("summarizing 0 messages"),
		);
		expect(lifecycleStatuses).toEqual([
			"mode-resolved",
			"history-producing",
			"history-produced",
			"history-validated",
			"turn-prefix-producing",
			"turn-prefix-produced",
			"assembled",
			"verifying",
			"committed",
			"completed",
		]);
	});
});
