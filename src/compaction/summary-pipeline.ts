import type { SummaryMode } from "../prompt.ts";
import { formatFileOperations, stripFileTags } from "../file-tags.ts";
import type { AutoCompactState } from "../state.ts";
import type { CompactionInvariant } from "./invariants.ts";
import type { CompactionPlan } from "./compaction-plan.ts";
import { commitVerifiedCompaction } from "./compaction-workflow.ts";
import {
	createCompactionLifecycleSnapshot,
	failCompactionLifecycle,
	transitionCompactionLifecycle,
	type CompactionLifecycleEventType,
	type CompactionLifecycleSnapshot,
} from "./lifecycle-state-machine.ts";
import { runCompactionPipeline, type CompactionFilter } from "./pipeline.ts";
import {
	buildNoPriorHistorySummary,
	buildSummaryRequest,
	buildTurnPrefixSummaryRequest,
	calculatePromptMaxTokens,
	calculateSummaryMaxTokens,
	calculateTurnPrefixMaxTokens,
	formatSplitTurnSummary,
} from "./summary-request.ts";
import { requestSummary, type SummaryProviderInput } from "./summary-provider.ts";
import { validateSummaryStructure } from "./summary-structure-guard.ts";
import type {
	FileListDetails,
	SafeCompactionPreparation,
	SafeCompactionReason,
	ValidatedExtensionCompaction,
} from "./types.ts";

export type SummaryAttemptFailure = (
	| {
			reason: "empty" | "provider-error" | "timeout" | "aborted";
			message?: string;
	  }
	| {
			reason:
				| "invalid-structure"
				| "too-long"
				| "invalid-result"
				| "verification-failed";
			message?: string;
	  }
) & { violatedInvariants?: readonly CompactionInvariant[] };

export type SummaryFragmentResult =
	| { ok: true; summary: string; maxTokens: number }
	| ({ ok: false } & SummaryAttemptFailure);

export type SummaryAttemptResult =
	| { ok: true; compaction: ValidatedExtensionCompaction; mode: SummaryMode }
	| ({ ok: false; mode: SummaryMode } & SummaryAttemptFailure);

export interface SummaryPipelineInput {
	preparation: SafeCompactionPreparation;
	state: AutoCompactState;
	plan: CompactionPlan;
	fileLists: FileListDetails;
	customInstructions?: string;
	reason: SafeCompactionReason;
	willRetry: boolean;
	model: SummaryProviderInput["model"];
	auth: SummaryProviderInput["auth"];
	signal?: AbortSignal;
	forceMode?: SummaryMode;
	lifecycle?: CompactionLifecycleSnapshot;
	onLifecycle?: (snapshot: CompactionLifecycleSnapshot) => void;
	onNotify?: (message: string) => void;
}

interface SummaryPipelineContext extends SummaryPipelineInput {
	lifecycle: CompactionLifecycleSnapshot;
	mode?: SummaryMode;
	history?: SummaryFragmentResult;
	turnPrefix?: SummaryFragmentResult;
	summary?: string;
	maxTokens?: number;
	attempt?: SummaryAttemptResult;
}

export function shouldRetrySummaryFailure(result: SummaryAttemptResult): boolean {
	return (
		!result.ok &&
		(result.reason === "empty" ||
			result.reason === "invalid-structure" ||
			result.reason === "too-long") &&
		result.mode !== "aggressive"
	);
}

export async function runSummaryAttemptPipeline(
	input: SummaryPipelineInput,
): Promise<SummaryAttemptResult> {
	const finalContext = await runCompactionPipeline<SummaryPipelineContext>(
		{ ...input, lifecycle: input.lifecycle ?? createPlannedLifecycle() },
		[
			resolveSummaryMode,
			requestHistorySummary,
			validateHistorySummary,
			requestTurnPrefixSummary,
			assembleSummaryFragments,
			verifyAndCommitSummary,
		],
	);
	if (finalContext.attempt) return finalContext.attempt;
	return {
		ok: false,
		mode: finalContext.mode ?? "standard",
		reason: "invalid-result",
		message: "summary pipeline completed without a result",
	};
}

const resolveSummaryMode: CompactionFilter<SummaryPipelineContext> = (context) => {
	const { mode } = buildSummaryRequest({
		preparation: context.preparation,
		state: context.state,
		customInstructions: context.customInstructions,
		reason: context.reason,
		willRetry: context.willRetry,
		forceMode: context.forceMode,
	});
	context.onNotify?.(
		`Autocompact v2: summarizing ${context.plan.messageCounts.total} messages with ${context.model.provider}/${context.model.id} (${mode}).`,
	);
	return { ...advanceLifecycle(context, "mode-resolved"), mode };
};

const requestHistorySummary: CompactionFilter<SummaryPipelineContext> = async (
	context,
) => {
	if (context.attempt) return context;
	const producing = advanceLifecycle(context, "history-requested");
	const mode = requireMode(producing);
	if (producing.preparation.messagesToSummarize.length === 0) {
		return {
			...advanceLifecycle(producing, "history-produced"),
			history: {
				ok: true,
				summary: stripFileTags(
					producing.preparation.previousSummary ?? buildNoPriorHistorySummary(),
				),
				maxTokens: calculateSummaryMaxTokens({
					reserveTokens: producing.preparation.settings.reserveTokens,
					modelMaxTokens: producing.model.maxTokens,
					mode,
				}),
			},
		};
	}

	const maxTokens = calculateSummaryMaxTokens({
		reserveTokens: producing.preparation.settings.reserveTokens,
		modelMaxTokens: producing.model.maxTokens,
		mode,
	});
	const { promptText } = buildSummaryRequest({
		preparation: producing.preparation,
		state: producing.state,
		customInstructions: producing.customInstructions,
		reason: producing.reason,
		willRetry: producing.willRetry,
		forceMode: producing.forceMode,
		promptMaxTokens: calculatePromptMaxTokens({
			modelContextWindow: getModelContextWindow(producing.model),
			outputMaxTokens: maxTokens,
		}),
	});
	const summaryResult = await requestSummary({
		model: producing.model,
		auth: producing.auth,
		promptText,
		maxTokens,
		signal: producing.signal,
	});
	if (!summaryResult.ok) {
		return fail(producing, summaryResult.reason, summaryResult.message);
	}
	return {
		...advanceLifecycle(producing, "history-produced"),
		history: {
			ok: true,
			summary: stripFileTags(summaryResult.summary),
			maxTokens,
		},
	};
};

const validateHistorySummary: CompactionFilter<SummaryPipelineContext> = (
	context,
) => {
	if (context.attempt) return context;
	const history = requireSuccessfulFragment(context.history, context, "history");
	if (!history.ok) return fail(context, history.reason, history.message);
	const structure = validateSummaryStructure(history.summary);
	if (!structure.ok) {
		return fail(
			context,
			"invalid-structure",
			structure.issues.join(", "),
			["required-summary-sections-preserved"],
		);
	}
	return advanceLifecycle(context, "history-validated");
};

const requestTurnPrefixSummary: CompactionFilter<SummaryPipelineContext> = async (
	context,
) => {
	if (context.attempt) return context;
	const producing = advanceLifecycle(context, "turn-prefix-requested");
	if (producing.preparation.turnPrefixMessages.length === 0) {
		return {
			...advanceLifecycle(producing, "turn-prefix-produced"),
			turnPrefix: { ok: true, summary: "", maxTokens: 0 },
		};
	}

	const maxTokens = calculateTurnPrefixMaxTokens({
		reserveTokens: producing.preparation.settings.reserveTokens,
		modelMaxTokens: producing.model.maxTokens,
	});
	const { promptText } = buildTurnPrefixSummaryRequest({
		preparation: producing.preparation,
		promptMaxTokens: calculatePromptMaxTokens({
			modelContextWindow: getModelContextWindow(producing.model),
			outputMaxTokens: maxTokens,
		}),
	});
	const summaryResult = await requestSummary({
		model: producing.model,
		auth: producing.auth,
		promptText,
		maxTokens,
		signal: producing.signal,
	});
	if (!summaryResult.ok) {
		return fail(producing, summaryResult.reason, summaryResult.message);
	}
	return {
		...advanceLifecycle(producing, "turn-prefix-produced"),
		turnPrefix: {
			ok: true,
			summary: stripFileTags(summaryResult.summary),
			maxTokens,
		},
	};
};

const assembleSummaryFragments: CompactionFilter<SummaryPipelineContext> = (
	context,
) => {
	if (context.attempt) return context;
	const history = requireSuccessfulFragment(context.history, context, "history");
	if (!history.ok) return fail(context, history.reason, history.message);
	const turnPrefix = requireSuccessfulFragment(
		context.turnPrefix,
		context,
		"turn-prefix",
	);
	if (!turnPrefix.ok) return fail(context, turnPrefix.reason, turnPrefix.message);
	let summary = turnPrefix.summary
		? formatSplitTurnSummary({
				historySummary: history.summary,
				turnPrefixSummary: turnPrefix.summary,
			})
		: history.summary;
	summary += formatFileOperations(
		context.fileLists.readFiles,
		context.fileLists.modifiedFiles,
	);
	return {
		...advanceLifecycle(context, "summary-assembled"),
		summary,
		maxTokens: Math.max(history.maxTokens, history.maxTokens + turnPrefix.maxTokens),
	};
};

const verifyAndCommitSummary: CompactionFilter<SummaryPipelineContext> = (
	context,
) => {
	if (context.attempt) return context;
	const verifying = advanceLifecycle(context, "verification-started");
	if (!verifying.summary || verifying.maxTokens === undefined) {
		return fail(verifying, "invalid-result", "assembled summary is missing");
	}
	const commit = commitVerifiedCompaction({
		plan: verifying.plan,
		summary: verifying.summary,
		maxTokens: verifying.maxTokens,
	});
	if (!commit.ok) {
		const reason = commit.verification.issues.includes("invalid-result")
			? "invalid-result"
			: commit.verification.issues.includes("too-long")
				? "too-long"
				: "verification-failed";
		return fail(
			verifying,
			reason,
			commit.verification.message,
			commit.verification.violatedInvariants,
		);
	}
	const completed = advanceLifecycle(
		advanceLifecycle(verifying, "commit-accepted"),
		"completed",
	);
	return {
		...completed,
		attempt: { ok: true, compaction: commit.compaction, mode: requireMode(completed) },
	};
};

function fail(
	context: SummaryPipelineContext,
	reason: SummaryAttemptFailure["reason"],
	message?: string,
	violatedInvariants?: readonly CompactionInvariant[],
): SummaryPipelineContext {
	const failedLifecycle = failCompactionLifecycle(context.lifecycle, message ?? reason);
	const failedContext = { ...context, lifecycle: failedLifecycle };
	failedContext.onLifecycle?.(failedLifecycle);
	return {
		...failedContext,
		attempt: {
			ok: false,
			mode: context.mode ?? "standard",
			reason,
			message,
			violatedInvariants,
		} as SummaryAttemptResult,
	};
}

function getModelContextWindow(model: SummaryProviderInput["model"]): number | undefined {
	const contextWindow = (model as { contextWindow?: unknown }).contextWindow;
	return typeof contextWindow === "number" && Number.isFinite(contextWindow)
		? contextWindow
		: undefined;
}

function requireMode(context: SummaryPipelineContext): SummaryMode {
	if (!context.mode) throw new Error("summary pipeline mode was not resolved");
	return context.mode;
}

type RequiredFragment =
	| { ok: true; summary: string; maxTokens: number }
	| ({ ok: false } & SummaryAttemptFailure);

function requireSuccessfulFragment(
	fragment: SummaryFragmentResult | undefined,
	_context: SummaryPipelineContext,
	name: string,
): RequiredFragment {
	if (!fragment) {
		return {
			ok: false,
			reason: "invalid-result",
			message: `${name} summary stage did not run`,
		};
	}
	return fragment;
}

function createPlannedLifecycle(): CompactionLifecycleSnapshot {
	let lifecycle = createCompactionLifecycleSnapshot();
	lifecycle = transitionCompactionLifecycle(lifecycle, { type: "event-observed" });
	lifecycle = transitionCompactionLifecycle(lifecycle, { type: "auth-resolved" });
	return transitionCompactionLifecycle(lifecycle, { type: "plan-built" });
}

function advanceLifecycle(
	context: SummaryPipelineContext,
	type: CompactionLifecycleEventType,
): SummaryPipelineContext {
	const lifecycle = transitionCompactionLifecycle(context.lifecycle, { type });
	context.onLifecycle?.(lifecycle);
	return { ...context, lifecycle };
}
