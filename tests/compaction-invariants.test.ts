import { describe, expect, it } from "vitest";
import { COMPACTION_VERIFICATION_ISSUE_INVARIANTS } from "../src/compaction/compaction-workflow.ts";
import {
	COMPACTION_LIFECYCLE_INITIAL_STATE,
	COMPACTION_LIFECYCLE_TERMINAL_STATES,
	createCompactionLifecycleSnapshot,
} from "../src/compaction/lifecycle-state-machine.ts";
import {
	COMPACTION_INVARIANT_DESCRIPTIONS,
	COMPACTION_INVARIANTS,
	type CompactionInvariant,
} from "../src/compaction/invariants.ts";

describe("compaction invariants", () => {
	it("declares every invariant with a description", () => {
		expect(COMPACTION_INVARIANTS).toEqual([
			"valid-lifecycle-transition",
			"terminal-states-are-absorbing",
			"required-summary-sections-preserved",
			"summary-size-bounded",
			"file-lists-preserved",
			"split-turn-context-preserved",
			"validated-result-only",
		]);
		expect(Object.keys(COMPACTION_INVARIANT_DESCRIPTIONS).sort()).toEqual(
			[...COMPACTION_INVARIANTS].sort(),
		);
		for (const invariant of COMPACTION_INVARIANTS) {
			expect(COMPACTION_INVARIANT_DESCRIPTIONS[invariant].length).toBeGreaterThan(0);
		}
	});

	it("grounds lifecycle constants in lifecycle invariants", () => {
		expect(createCompactionLifecycleSnapshot().status).toBe(
			COMPACTION_LIFECYCLE_INITIAL_STATE,
		);
		expect(COMPACTION_LIFECYCLE_TERMINAL_STATES).toEqual([
			"completed",
			"skipped",
			"failed",
		]);
	});

	it("maps every verification issue to a known invariant", () => {
		const mappedInvariants = Object.values(
			COMPACTION_VERIFICATION_ISSUE_INVARIANTS,
		) as CompactionInvariant[];
		for (const invariant of mappedInvariants) {
			expect(COMPACTION_INVARIANTS).toContain(invariant);
		}
		expect(mappedInvariants).toContain("required-summary-sections-preserved");
		expect(mappedInvariants).toContain("summary-size-bounded");
		expect(mappedInvariants).toContain("file-lists-preserved");
		expect(mappedInvariants).toContain("split-turn-context-preserved");
		expect(mappedInvariants).toContain("validated-result-only");
	});
});
