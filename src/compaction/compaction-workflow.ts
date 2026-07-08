import { parseFileLists } from "../file-tags.ts";
import { buildValidatedCompaction } from "./result-guard.ts";
import { validateSummarySize } from "./summary-size-policy.ts";
import { validateSummaryStructure } from "./summary-structure-guard.ts";
import type { CompactionInvariant } from "./invariants.ts";
import type { CompactionPlan } from "./compaction-plan.ts";
import type { ValidatedExtensionCompaction } from "./types.ts";

export type CompactionVerificationIssue =
	| "invalid-structure"
	| "too-long"
	| "missing-file-list"
	| "missing-turn-prefix-context"
	| "invalid-result";

export const COMPACTION_VERIFICATION_ISSUE_INVARIANTS = {
	"invalid-structure": "required-summary-sections-preserved",
	"too-long": "summary-size-bounded",
	"missing-file-list": "file-lists-preserved",
	"missing-turn-prefix-context": "split-turn-context-preserved",
	"invalid-result": "validated-result-only",
} as const satisfies Record<CompactionVerificationIssue, CompactionInvariant>;

export interface CompactionVerificationResult {
	ok: boolean;
	issues: CompactionVerificationIssue[];
	message?: string;
	violatedInvariants: CompactionInvariant[];
}

export type VerifiedCompactionCommit =
	| { ok: true; compaction: ValidatedExtensionCompaction }
	| { ok: false; verification: CompactionVerificationResult };

export function verifyCompactionSummary(input: {
	plan: CompactionPlan;
	summary: string;
	maxTokens: number;
}): CompactionVerificationResult {
	const issues: CompactionVerificationIssue[] = [];
	const messages: string[] = [];

	const structure = validateSummaryStructure(input.summary);
	if (!structure.ok) {
		issues.push("invalid-structure");
		messages.push(`structure: ${structure.issues.join(", ")}`);
	}

	const size = validateSummarySize({
		summary: input.summary,
		tokensBefore: input.plan.tokensBefore,
		maxTokens: input.maxTokens,
	});
	if (!size.ok) {
		issues.push("too-long");
		messages.push(
			`size: ${size.estimatedTokens} estimated tokens exceeds ${size.maxAllowedTokens}`,
		);
	}

	const files = parseFileLists(input.summary);
	const missingReadFiles = input.plan.mustPreserve.fileLists.readFiles.filter(
		(file) => !files.readFiles.includes(file),
	);
	const missingModifiedFiles = input.plan.mustPreserve.fileLists.modifiedFiles.filter(
		(file) => !files.modifiedFiles.includes(file),
	);
	if (missingReadFiles.length > 0 || missingModifiedFiles.length > 0) {
		issues.push("missing-file-list");
		messages.push(
			`files: missing read=[${missingReadFiles.join(", ")}] modified=[${missingModifiedFiles.join(", ")}]`,
		);
	}

	if (
		input.plan.mustPreserve.turnPrefixContext &&
		!/Turn Context \(split turn\)/i.test(input.summary)
	) {
		issues.push("missing-turn-prefix-context");
		messages.push("turn prefix context is required by the compaction plan");
	}

	return {
		ok: issues.length === 0,
		issues,
		violatedInvariants: Array.from(
			new Set(issues.map((issue) => COMPACTION_VERIFICATION_ISSUE_INVARIANTS[issue])),
		),
		message: messages.join("; ") || undefined,
	};
}

export function commitVerifiedCompaction(input: {
	plan: CompactionPlan;
	summary: string;
	maxTokens: number;
}): VerifiedCompactionCommit {
	const verification = verifyCompactionSummary(input);
	if (!verification.ok) return { ok: false, verification };

	const compaction = buildValidatedCompaction({
		summary: input.summary,
		firstKeptEntryId: input.plan.firstKeptEntryId,
		tokensBefore: input.plan.tokensBefore,
		details: input.plan.mustPreserve.fileLists,
	});
	if (!compaction) {
		return {
			ok: false,
			verification: {
				ok: false,
				issues: ["invalid-result"],
				message: "validated compaction result could not be built",
				violatedInvariants: ["validated-result-only"],
			},
		};
	}

	return { ok: true, compaction };
}
