import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/state.ts";
import {
	buildSummaryRequest,
	buildTurnPrefixSummaryRequest,
	calculatePromptMaxTokens,
	calculateSummaryMaxTokens,
	calculateTurnPrefixMaxTokens,
	formatSplitTurnSummary,
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

	it("budgets oversized summary prompts before provider calls", () => {
		const state = createInitialState();
		const request = buildSummaryRequest({
			preparation: preparation({
				messagesToSummarize: [
					{
						role: "user",
						content: [{ type: "text", text: "large ".repeat(20_000) }],
					},
				],
				previousSummary: "previous ".repeat(10_000),
			}),
			state,
			promptMaxTokens: 1_000,
		});

		expect(request.promptText).toContain("omitted approximately");
		expect(request.promptText.length).toBeLessThanOrEqual(4_200);
		expect(request.promptText).toContain("Use this exact structure");
	});

	it("condenses noisy todo snapshots before provider prompt budgeting", () => {
		const state = createInitialState();
		const noisyTodoSnapshot = [
			"● Todos (8/10)",
			"├─ ✓ #1 Bootstrap MVP project",
			"├─ ✓ #2 Implement terminal core",
			"├─ ✓ #3 Add tests",
			"├─ ✓ #4 Wire renderer",
			"├─ ✓ #5 Validate shaper",
			"├─ ✓ #6 Update docs",
			"├─ ✓ #7 Run checks",
			"├─ ✓ #8 Review diff",
			"├─ □ #9 Inspect compact output",
			"└─ ⟳ #10 Patch noise filter",
		].join("\n");
		const request = buildSummaryRequest({
			preparation: preparation({
				messagesToSummarize: [
					{
						role: "assistant",
						content: [{ type: "text", text: noisyTodoSnapshot }],
					},
				],
			}),
			state,
		});

		expect(request.promptText).toContain("condensed 10-row todo snapshot");
		expect(request.promptText).toContain("Inspect compact output");
		expect(request.promptText).not.toContain("Bootstrap MVP project");
	});

	it("derives prompt budget from model context minus output budget", () => {
		expect(
			calculatePromptMaxTokens({
				modelContextWindow: 8_000,
				outputMaxTokens: 1_000,
			}),
		).toBe(5_976);
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

	it("builds a dedicated turn-prefix prompt separate from history summary", () => {
		const request = buildTurnPrefixSummaryRequest({
			preparation: preparation({
				turnPrefixMessages: [
					{ role: "user", content: [{ type: "text", text: "large request" }] },
				],
			}),
		});

		expect(request.allMessages).toHaveLength(1);
		expect(request.promptText).toContain("<turn-prefix-messages>");
		expect(request.promptText).toContain("PREFIX of a turn");
		expect(
			calculateTurnPrefixMaxTokens({
				reserveTokens: 1000,
				modelMaxTokens: 10_000,
			}),
		).toBe(500);
	});

	it("budgets oversized split-turn prefix prompts", () => {
		const request = buildTurnPrefixSummaryRequest({
			preparation: preparation({
				turnPrefixMessages: [
					{
						role: "user",
						content: [{ type: "text", text: "prefix ".repeat(20_000) }],
					},
				],
			}),
			promptMaxTokens: 900,
		});

		expect(request.promptText).toContain("omitted approximately");
		expect(request.promptText.length).toBeLessThanOrEqual(3_800);
		expect(request.promptText).toContain("PREFIX of a turn");
	});

	it("formats split-turn summaries with the original turn context marker", () => {
		expect(
			formatSplitTurnSummary({
				historySummary: "history",
				turnPrefixSummary: "prefix",
			}),
		).toBe("history\n\n---\n\n**Turn Context (split turn):**\n\nprefix");
	});
});
