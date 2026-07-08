import { describe, expect, it } from "vitest";
import { condenseSerializedConversationNoise } from "../src/compaction/summary-noise-filter.ts";

describe("condenseSerializedConversationNoise", () => {
	it("condenses verbose todo snapshots to actionable rows", () => {
		const text = [
			"before",
			"● Todos (9/11)",
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
			"after",
		].join("\n");

		const condensed = condenseSerializedConversationNoise(text);

		expect(condensed).toContain("Todos (9/11)");
		expect(condensed).toContain("condensed 10-row todo snapshot");
		expect(condensed).toContain("omitted 8 completed rows");
		expect(condensed).toContain("Inspect compact output");
		expect(condensed).toContain("Patch noise filter");
		expect(condensed).not.toContain("Bootstrap MVP project");
		expect(condensed).toContain("after");
	});

	it("condenses large count/path command-output runs", () => {
		const output = Array.from(
			{ length: 14 },
			(_, index) => `${50 - index} internal/example/file-${index}.ts`,
		).join("\n");

		const condensed = condenseSerializedConversationNoise(output);

		expect(condensed).toContain("50 internal/example/file-0.ts");
		expect(condensed).toContain("37 internal/example/file-13.ts");
		expect(condensed).toContain("omitted 7 count/path output lines");
		expect(condensed).not.toContain("44 internal/example/file-6.ts");
	});

	it("condenses long completed checklist runs", () => {
		const completed = Array.from(
			{ length: 9 },
			(_, index) => `- [x] completed task ${index + 1}`,
		).join("\n");

		const condensed = condenseSerializedConversationNoise(completed);

		expect(condensed).toContain("completed task 1");
		expect(condensed).toContain("completed task 3");
		expect(condensed).toContain("omitted 6 completed checklist rows");
		expect(condensed).not.toContain("completed task 8");
	});
});
