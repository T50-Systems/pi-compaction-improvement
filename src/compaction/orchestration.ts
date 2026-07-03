import type { NotifyContextPort } from "./ports.ts";
import {
	formatFileOperations,
	mergeFileLists,
	parseFileLists,
	stripFileTags,
} from "../file-tags.ts";
import type { AutoCompactState } from "../state.ts";
import { computeFileLists } from "./file-operations.ts";
import { parseBeforeCompactEvent } from "./event-guard.ts";
import { buildValidatedCompaction } from "./result-guard.ts";
import {
	buildSummaryRequest,
	calculateSummaryMaxTokens,
} from "./summary-request.ts";
import { requestSummary, type SummaryProviderInput } from "./summary-provider.ts";
import { notify } from "./telemetry.ts";

interface SummaryContextPort extends NotifyContextPort {
  model?: SummaryProviderInput["model"];
  modelRegistry: {
    getApiKeyAndHeaders(
      model: SummaryProviderInput["model"],
    ): Promise<SummaryProviderInput["auth"] & { ok: boolean }>;
  };
}

export async function handleBeforeCompact(
	event: unknown,
	ctx: SummaryContextPort,
	state: AutoCompactState,
): Promise<ReturnType<typeof buildValidatedCompaction> | undefined> {
	const safeEvent = parseBeforeCompactEvent(event);
	if (!safeEvent) {
		notify(
			ctx,
			"Autocompact v2: received an incompatible compaction event; using default compaction.",
			"warning",
		);
		return;
	}

	const { preparation, signal, customInstructions } = safeEvent;
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

	const { allMessages, promptText } = buildSummaryRequest({
		preparation,
		state,
		customInstructions,
	});
	if (allMessages.length === 0) return;

	try {
		notify(
			ctx,
			`Autocompact v2: summarizing ${allMessages.length} messages with ${model.provider}/${model.id}.`,
			"info",
		);
		const summaryResult = await requestSummary({
			model,
			auth,
			promptText,
			maxTokens: calculateSummaryMaxTokens({
				reserveTokens: settings.reserveTokens,
				modelMaxTokens: model.maxTokens,
			}),
			signal,
		});

		if (!summaryResult.ok) {
			if (summaryResult.reason !== "aborted") {
				notify(
					ctx,
					fallbackMessageForSummaryFailure(summaryResult),
					summaryResult.reason === "provider-error" ? "error" : "warning",
				);
			}
			return;
		}

		let summary = stripFileTags(summaryResult.summary);
		const previousFiles = parseFileLists(previousSummary);
		const currentFiles = computeFileLists(fileOps);
		const mergedFiles = mergeFileLists(previousFiles, currentFiles);
		summary += formatFileOperations(
			mergedFiles.readFiles,
			mergedFiles.modifiedFiles,
		);

		const compaction = buildValidatedCompaction({
			summary,
			firstKeptEntryId,
			tokensBefore,
			details: mergedFiles,
		});
		if (!compaction) {
			notify(
				ctx,
				"Autocompact v2 produced an invalid summary result; using default compaction.",
				"warning",
			);
		}
		return compaction;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (signal?.aborted !== true)
			notify(ctx, `Autocompact v2 failed: ${message}`, "error");
		return;
	}
}

function fallbackMessageForSummaryFailure(
	result: Exclude<Awaited<ReturnType<typeof requestSummary>>, { ok: true }>,
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
		default:
			return "Autocompact v2 summary request failed; using default compaction.";
	}
}
