import { describe, expect, it } from "vitest";
import {
	estimateTokens,
	validateSummarySize,
} from "../src/compaction/summary-size-policy.ts";

describe("summary size policy", () => {
	it("estimates tokens from characters", () => {
		expect(estimateTokens("12345678")).toBe(2);
	});

	it("accepts compact summaries under the output budget", () => {
		expect(
			validateSummarySize({
				summary: "short summary",
				tokensBefore: 10_000,
				maxTokens: 800,
			}).ok,
		).toBe(true);
	});

	it("rejects summaries that are too large to be useful compaction", () => {
		const result = validateSummarySize({
			summary: "x".repeat(4000),
			tokensBefore: 1000,
			maxTokens: 900,
		});

		expect(result.ok).toBe(false);
		expect(result.issues).toContain("too-long");
	});
});
