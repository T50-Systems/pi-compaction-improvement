import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/state.ts";
import {
	buildSummaryRequest,
	calculateSummaryMaxTokens,
	resolveSummaryReason,
} from "../src/compaction/summary-request.ts";
import type { SafeCompactionPreparation } from "../src/compaction/types.ts";

function preparation(
	overrides: Partial<SafeCompactionPreparation> = {},
): SafeCompactionPreparation {
	return {
		messagesToSummarize: [
			{ role: "user", content: [{ type: "text", text: "hello" }] },
		],
		turnPrefixMessages: [],
		firstKeptEntryId: "entry-1",
		tokensBefore: 1000,
		previousSummary: undefined,
		fileOps: { read: new Set(), written: new Set(), edited: new Set() },
		settings: { reserveTokens: 2048 },
		...overrides,
	};
}

describe("summary request", () => {
	it("maps compaction reasons from state", () => {
		const state = createInitialState();
		expect(resolveSummaryReason(state)).toBe("threshold");
		state.lastCompactionReason = "manual-now";
		expect(resolveSummaryReason(state)).toBe("manual");
		state.lastCompactionReason = "emergency-near-limit";
		expect(resolveSummaryReason(state)).toBe("overflow");
	});

	it("builds prompt text with previous summary and context", () => {
		const state = createInitialState();
		state.lastCompactionReason = "manual-now";
		const request = buildSummaryRequest({
			preparation: preparation({ previousSummary: "old summary" }),
			state,
			customInstructions: "extra focus",
		});

		expect(request.reason).toBe("manual");
		expect(request.allMessages).toHaveLength(1);
		expect(request.promptText).toContain("<messages-to-summarize>");
		expect(request.promptText).toContain("old summary");
		expect(request.promptText).toContain("reason=manual");
		expect(request.promptText).toContain("willRetry=false");
	});

	it("caps max tokens by reserve and model limit", () => {
		expect(
			calculateSummaryMaxTokens({
				reserveTokens: 1000,
				modelMaxTokens: 10_000,
			}),
		).toBe(800);
		expect(
			calculateSummaryMaxTokens({ reserveTokens: 1000, modelMaxTokens: 500 }),
		).toBe(500);
	});

	it("uses aggressive mode and lower output budget for retry compaction", () => {
		const state = createInitialState();
		const request = buildSummaryRequest({
			preparation: preparation(),
			state,
			reason: "threshold",
			willRetry: true,
		});

		expect(request.mode).toBe("aggressive");
		expect(request.promptText).toContain("willRetry=true");
		expect(
			calculateSummaryMaxTokens({
				reserveTokens: 1000,
				modelMaxTokens: 10_000,
				mode: request.mode,
			}),
		).toBe(550);
	});
});
