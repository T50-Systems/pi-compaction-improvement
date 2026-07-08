export const COMPACTION_INVARIANTS = [
	"valid-lifecycle-transition",
	"terminal-states-are-absorbing",
	"required-summary-sections-preserved",
	"summary-size-bounded",
	"file-lists-preserved",
	"split-turn-context-preserved",
	"validated-result-only",
] as const;

export type CompactionInvariant = (typeof COMPACTION_INVARIANTS)[number];

export const COMPACTION_INVARIANT_DESCRIPTIONS = {
	"valid-lifecycle-transition":
		"Every lifecycle event must be accepted by the transition function for the current state.",
	"terminal-states-are-absorbing":
		"Completed, skipped, and failed lifecycle states must not allow further transitions.",
	"required-summary-sections-preserved":
		"A committed summary must preserve the required operator-facing sections.",
	"summary-size-bounded":
		"A committed summary must stay within the configured summary token bound.",
	"file-lists-preserved":
		"A committed summary must preserve all file lists captured by the compaction plan.",
	"split-turn-context-preserved":
		"When a turn is split, a committed summary must include explicit split-turn context.",
	"validated-result-only":
		"Only a validated Pi-compatible compaction object may be returned to the core runtime.",
} as const satisfies Record<CompactionInvariant, string>;
