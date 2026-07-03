import { describe, expect, it } from "vitest";
import { validateSummaryStructure } from "../src/compaction/summary-structure-guard.ts";

const VALID_SUMMARY = `## Goal
Keep the implementation moving.

## Progress
### Done
- [x] Added a summary guard.

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
- src/compaction/summary-structure-guard.ts`;

describe("summary structure guard", () => {
	it("accepts summaries with required operational sections", () => {
		expect(validateSummaryStructure(VALID_SUMMARY)).toEqual({
			ok: true,
			issues: [],
			missingHeaders: [],
		});
	});

	it("rejects prose summaries that omit required headers", () => {
		const result = validateSummaryStructure("A short summary.");

		expect(result.ok).toBe(false);
		expect(result.issues).toContain("missing-header");
		expect(result.missingHeaders).toContain("Immediate Next Action");
	});

	it("rejects raw template placeholders", () => {
		const result = validateSummaryStructure(
			VALID_SUMMARY.replace(
				"Keep the implementation moving.",
				"[What the user is trying to accomplish]",
			),
		);

		expect(result.ok).toBe(false);
		expect(result.issues).toContain("placeholder-content");
	});
});
