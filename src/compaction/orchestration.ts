import type { SummaryMode } from "../prompt.ts";
import type { AutoCompactState } from "../state.ts";
import {
	formatFileOperations,
	mergeFileLists,
	parseFileLists,
	stripFileTags,
} from "../file-tags.ts";
import { computeFileLists } from "./file-operations.ts";
import { parseBeforeCompactEvent } from "./event-guard.ts";
import { buildCompactionPlan } from "./compaction-plan.ts";
import {
	buildNoPriorHistorySummary,
	buildSummaryRequest,
	buildTurnPrefixSummaryRequest,
	calculateSummaryMaxTokens,
	calculateTurnPrefixMaxTokens,
	formatSplitTurnSummary,
} from "./summary-request.ts";
import {
	requestSummary,
	type SummaryProviderInput,
} from "./summary-provider.ts";
import { commitVerifiedCompaction } from "./compaction-workflow.ts";
import { validateSummaryStructure } from "./summary-structure-guard.ts";
import { notify } from "./telemetry.ts";
import type { NotifyContextPort } from "./ports.ts";
import type { ValidatedExtensionCompaction } from "./types.ts";

interface SummaryContextPort extends NotifyContextPort {
	model?: SummaryProviderInput["model"];
	modelRegistry: {
		getApiKeyAndHeaders(
			model: SummaryProviderInput["model"],
		): Promise<SummaryProviderInput["auth"] & { ok: boolean }>;
	};
}

type CompactionResult = ValidatedExtensionCompaction | undefined;

type SummaryAttemptFailure =
	| {
			reason: "empty" | "provider-error" | "timeout" | "aborted";
			message?: string;
	  }
	| {
			reason: "invalid-structure" | "too-long" | "invalid-result" | "verification-failed";
			message?: string;
	  };

type SummaryFragmentResult =
	| { ok: true; summary: string; maxTokens: number }
	| ({ ok: false } & SummaryAttemptFailure);

type SummaryAttemptResult =
	| { ok: true; compaction: NonNullable<CompactionResult>; mode: SummaryMode }
	| ({ ok: false; mode: SummaryMode } & SummaryAttemptFailure);

function shouldRetrySummaryFailure(result: SummaryAttemptResult): boolean {
	return (
		!result.ok &&
		(result.reason === "empty" ||
			result.reason === "invalid-structure" ||
			result.reason === "too-long") &&
		result.mode !== "aggressive"
	);
}

export async function handleBeforeCompact(
	event: unknown,
	ctx: SummaryContextPort,
	state: AutoCompactState,
): Promise<CompactionResult | undefined> {
	const safeEvent = parseBeforeCompactEvent(event);
	if (!safeEvent) {
		notify(
			ctx,
			"Autocompact v2: received an incompatible compaction event; using default compaction.",
			"warning",
		);
		return;
	}

	const { preparation, signal, customInstructions, reason, willRetry } =
		safeEvent;
	const { firstKeptEntryId, tokensBefore, previousSummary, fileOps, settings } =
		preparation;
	const model = ctx.model;
	if (!model) {
		notify(
			ctx,
			"Autocompact v2: no active model; falling back to default compaction.",
			"warning",
		);
		return;
	}

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) {
		notify(
			ctx,
			`Autocompact v2: could not resolve auth for ${model.provider}/${model.id}; using default compaction.`,
			"warning",
		);
		return;
	}

	const allMessages = [
		...preparation.messagesToSummarize,
		...preparation.turnPrefixMessages,
	];
	if (allMessages.length === 0) return;

	const previousFiles = parseFileLists(previousSummary);
	const currentFiles = computeFileLists(fileOps);
	const mergedFiles = mergeFileLists(previousFiles, currentFiles);
	const plan = buildCompactionPlan({
		preparation,
		state,
		reason,
		willRetry,
		customInstructions,
		fileLists: mergedFiles,
	});

	const requestHistorySummary = async (
		mode: SummaryMode,
		forceMode?: SummaryMode,
	): Promise<SummaryFragmentResult> => {
		if (preparation.messagesToSummarize.length === 0) {
			return {
				ok: true,
				summary: stripFileTags(previousSummary ?? buildNoPriorHistorySummary()),
				maxTokens: calculateSummaryMaxTokens({
					reserveTokens: settings.reserveTokens,
					modelMaxTokens: model.maxTokens,
					mode,
				}),
			};
		}

		const { promptText } = buildSummaryRequest({
			preparation,
			state,
			customInstructions,
			reason,
			willRetry,
			forceMode,
		});
		const maxTokens = calculateSummaryMaxTokens({
			reserveTokens: settings.reserveTokens,
			modelMaxTokens: model.maxTokens,
			mode,
		});
		const summaryResult = await requestSummary({
			model,
			auth,
			promptText,
			maxTokens,
			signal,
		});
		if (!summaryResult.ok) {
			return {
				ok: false,
				reason: summaryResult.reason,
				message: summaryResult.message,
			};
		}
		return {
			ok: true,
			summary: stripFileTags(summaryResult.summary),
			maxTokens,
		};
	};

	const requestTurnPrefixSummary = async (): Promise<SummaryFragmentResult> => {
		if (preparation.turnPrefixMessages.length === 0) {
			return { ok: true, summary: "", maxTokens: 0 };
		}
		const { promptText } = buildTurnPrefixSummaryRequest({ preparation });
		const maxTokens = calculateTurnPrefixMaxTokens({
			reserveTokens: settings.reserveTokens,
			modelMaxTokens: model.maxTokens,
		});
		const summaryResult = await requestSummary({
			model,
			auth,
			promptText,
			maxTokens,
			signal,
		});
		if (!summaryResult.ok) {
			return {
				ok: false,
				reason: summaryResult.reason,
				message: summaryResult.message,
			};
		}
		return {
			ok: true,
			summary: stripFileTags(summaryResult.summary),
			maxTokens,
		};
	};

	const summarize = async (
		forceMode?: SummaryMode,
	): Promise<SummaryAttemptResult> => {
		const { mode } = buildSummaryRequest({
			preparation,
			state,
			customInstructions,
			reason,
			willRetry,
			forceMode,
		});
		notify(
			ctx,
			`Autocompact v2: summarizing ${allMessages.length} messages with ${model.provider}/${model.id} (${mode}).`,
			"info",
		);

		const historyResult = await requestHistorySummary(mode, forceMode);
		if (!historyResult.ok) {
			return {
				ok: false,
				mode,
				reason: historyResult.reason,
				message: historyResult.message,
			};
		}

		const structure = validateSummaryStructure(historyResult.summary);
		if (!structure.ok) {
			return {
				ok: false,
				mode,
				reason: "invalid-structure",
				message: structure.issues.join(", "),
			};
		}

		const turnPrefixResult = await requestTurnPrefixSummary();
		if (!turnPrefixResult.ok) {
			return {
				ok: false,
				mode,
				reason: turnPrefixResult.reason,
				message: turnPrefixResult.message,
			};
		}

		let summary = turnPrefixResult.summary
			? formatSplitTurnSummary({
					historySummary: historyResult.summary,
					turnPrefixSummary: turnPrefixResult.summary,
				})
			: historyResult.summary;
		summary += formatFileOperations(
			mergedFiles.readFiles,
			mergedFiles.modifiedFiles,
		);

		const maxTokens = Math.max(
			historyResult.maxTokens,
			historyResult.maxTokens + turnPrefixResult.maxTokens,
		);
		const commit = commitVerifiedCompaction({
			plan,
			summary,
			maxTokens,
		});
		if (!commit.ok) {
			const reason = commit.verification.issues.includes("invalid-result")
				? "invalid-result"
				: commit.verification.issues.includes("too-long")
					? "too-long"
					: "verification-failed";
			return {
				ok: false,
				mode,
				reason,
				message: commit.verification.message,
			};
		}
		return { ok: true, compaction: commit.compaction, mode };
	};

	try {
		const firstAttempt = await summarize();
		const finalAttempt = shouldRetrySummaryFailure(firstAttempt)
			? await summarize("aggressive")
			: firstAttempt;
		if (finalAttempt.ok) return finalAttempt.compaction;

		if (finalAttempt.reason !== "aborted") {
			notify(
				ctx,
				fallbackMessageForSummaryFailure(finalAttempt),
				finalAttempt.reason === "provider-error" ? "error" : "warning",
			);
		}
		return;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (signal?.aborted !== true)
			notify(ctx, `Autocompact v2 failed: ${message}`, "error");
		return;
	}
}

function fallbackMessageForSummaryFailure(result: SummaryAttemptFailure): string {
	switch (result.reason) {
		case "empty":
			return "Autocompact v2 produced an empty summary; using default compaction.";
		case "timeout":
			return "Autocompact v2 summary request timed out; using default compaction.";
		case "aborted":
			return "Autocompact v2 summary request was aborted; using default compaction.";
		case "provider-error":
			return `Autocompact v2 failed: ${result.message ?? "provider error"}`;
		case "invalid-structure":
			return `Autocompact v2 produced an invalid summary structure${result.message ? ` (${result.message})` : ""}; using default compaction.`;
		case "too-long":
			return `Autocompact v2 summary was too long${result.message ? ` (${result.message})` : ""}; using default compaction.`;
		case "invalid-result":
			return "Autocompact v2 produced an invalid summary result; using default compaction.";
		case "verification-failed":
			return `Autocompact v2 summary failed plan verification${result.message ? ` (${result.message})` : ""}; using default compaction.`;
		default:
			return "Autocompact v2 summary request failed; using default compaction.";
	}
}
