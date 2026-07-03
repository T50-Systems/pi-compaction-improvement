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
import { buildValidatedCompaction } from "./result-guard.ts";
import {
	buildSummaryRequest,
	calculateSummaryMaxTokens,
} from "./summary-request.ts";
import {
	requestSummary,
	type SummaryProviderInput,
} from "./summary-provider.ts";
import { validateSummarySize } from "./summary-size-policy.ts";
import { validateSummaryStructure } from "./summary-structure-guard.ts";
import { notify } from "./telemetry.ts";
import type { NotifyContextPort } from "./ports.ts";

interface SummaryContextPort extends NotifyContextPort {
	model?: SummaryProviderInput["model"];
	modelRegistry: {
		getApiKeyAndHeaders(
			model: SummaryProviderInput["model"],
		): Promise<SummaryProviderInput["auth"] & { ok: boolean }>;
	};
}

type CompactionResult = ReturnType<typeof buildValidatedCompaction>;

type SummaryAttemptFailure =
	| {
			reason: "empty" | "provider-error" | "timeout" | "aborted";
			message?: string;
	  }
	| {
			reason: "invalid-structure" | "too-long" | "invalid-result";
			message?: string;
	  };

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

	const summarize = async (
		forceMode?: SummaryMode,
	): Promise<SummaryAttemptResult> => {
		const { promptText, mode } = buildSummaryRequest({
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

		notify(
			ctx,
			`Autocompact v2: summarizing ${allMessages.length} messages with ${model.provider}/${model.id} (${mode}).`,
			"info",
		);
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
				mode,
				reason: summaryResult.reason,
				message: summaryResult.message,
			};
		}

		let summary = stripFileTags(summaryResult.summary);
		const structure = validateSummaryStructure(summary);
		if (!structure.ok) {
			return {
				ok: false,
				mode,
				reason: "invalid-structure",
				message: structure.issues.join(", "),
			};
		}

		summary += formatFileOperations(
			mergedFiles.readFiles,
			mergedFiles.modifiedFiles,
		);
		const size = validateSummarySize({ summary, tokensBefore, maxTokens });
		if (!size.ok) {
			return {
				ok: false,
				mode,
				reason: "too-long",
				message: `${size.estimatedTokens} estimated tokens exceeds ${size.maxAllowedTokens}`,
			};
		}

		const compaction = buildValidatedCompaction({
			summary,
			firstKeptEntryId,
			tokensBefore,
			details: mergedFiles,
		});
		if (!compaction) return { ok: false, mode, reason: "invalid-result" };
		return { ok: true, compaction, mode };
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

function fallbackMessageForSummaryFailure(
	result: SummaryAttemptFailure,
): string {
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
		default:
			return "Autocompact v2 summary request failed; using default compaction.";
	}
}
