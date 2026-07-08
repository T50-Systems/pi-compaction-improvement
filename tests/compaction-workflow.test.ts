import { describe, expect, it } from "vitest";
import { buildCompactionPlan } from "../src/compaction/compaction-plan.ts";
import {
	commitVerifiedCompaction,
	verifyCompactionSummary,
} from "../src/compaction/compaction-workflow.ts";
import { createInitialState } from "../src/state.ts";

const VALID_SUMMARY = `## Goal
Keep the implementation moving.

## Progress
### Done
- [x] Added a contract-driven compaction workflow.

### In Progress
- [ ] Run validation.

### Blocked
- None.

## Immediate Next Action
1. Run the test suite.

## Continuation Contract
- Resume automatically after compaction: yes
- If no, ask the user exactly this: N/A

## Critical Context
- src/compaction/compaction-workflow.ts

<read-files>
src/compaction/orchestration.ts
</read-files>

<modified-files>
src/compaction/compaction-workflow.ts
</modified-files>`;

function makePlan(overrides: Partial<Parameters<typeof buildCompactionPlan>[0]> = {}) {
	return buildCompactionPlan({
		preparation: {
			messagesToSummarize: [{ role: "user", content: "hello" }],
			turnPrefixMessages: [],
			firstKeptEntryId: "entry-1",
			tokensBefore: 1000,
			previousSummary: undefined,
			fileOps: { read: new Set(), written: new Set(), edited: new Set() },
			settings: { reserveTokens: 2048 },
		},
		state: createInitialState(),
		reason: "threshold",
		willRetry: false,
		fileLists: {
			readFiles: ["src/compaction/orchestration.ts"],
			modifiedFiles: ["src/compaction/compaction-workflow.ts"],
		},
		now: 1,
		...overrides,
	});
}

describe("contract-driven compaction workflow", () => {
	it("commits a summary only after plan verification passes", () => {
		const result = commitVerifiedCompaction({
			plan: makePlan(),
			summary: VALID_SUMMARY,
			maxTokens: 2048,
		});

		expect(result).toEqual({
			ok: true,
			compaction: {
				compaction: {
					summary: VALID_SUMMARY,
					firstKeptEntryId: "entry-1",
					tokensBefore: 1000,
					details: {
						readFiles: ["src/compaction/orchestration.ts"],
						modifiedFiles: ["src/compaction/compaction-workflow.ts"],
					},
				},
			},
		});
	});

	it("rejects summaries that omit plan-preserved file lists", () => {
		const result = verifyCompactionSummary({
			plan: makePlan(),
			summary: VALID_SUMMARY.replace(
				"<modified-files>\nsrc/compaction/compaction-workflow.ts\n</modified-files>",
				"<modified-files>\nsrc/compaction/other.ts\n</modified-files>",
			),
			maxTokens: 2048,
		});

		expect(result.ok).toBe(false);
		expect(result.issues).toContain("missing-file-list");
		expect(result.violatedInvariants).toContain("file-lists-preserved");
	});

	it("requires explicit turn-prefix context when the plan has split-turn input", () => {
		const plan = makePlan({
			preparation: {
				messagesToSummarize: [],
				turnPrefixMessages: [{ role: "user", content: "prefix" }],
				firstKeptEntryId: "entry-1",
				tokensBefore: 1000,
				previousSummary: undefined,
				fileOps: { read: new Set(), written: new Set(), edited: new Set() },
				settings: { reserveTokens: 2048 },
			},
		});

		const result = verifyCompactionSummary({
			plan,
			summary: VALID_SUMMARY,
			maxTokens: 2048,
		});

		expect(result.ok).toBe(false);
		expect(result.issues).toContain("missing-turn-prefix-context");
		expect(result.violatedInvariants).toContain(
			"split-turn-context-preserved",
		);
	});
});
