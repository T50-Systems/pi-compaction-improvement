import type { AutoCompactState } from "../state.ts";
import { mergeFileLists, parseFileLists } from "../file-tags.ts";
import { buildCompactionPlan } from "./compaction-plan.ts";
import { parseBeforeCompactEvent } from "./event-guard.ts";
import { computeFileLists } from "./file-operations.ts";
import {
	appendLifecycleDiagnostic,
	type LifecycleFallbackCategory,
} from "./lifecycle-diagnostics.ts";
import type { NotifyContextPort } from "./ports.ts";
import {
	runSummaryAttemptPipeline,
	shouldRetrySummaryFailure,
	type SummaryAttemptFailure,
	type SummaryAttemptResult,
} from "./summary-pipeline.ts";
import { type SummaryProviderInput } from "./summary-provider.ts";
import { notify } from "./telemetry.ts";
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

export async function handleBeforeCompact(
	event: unknown,
	ctx: SummaryContextPort,
	state: AutoCompactState,
): Promise<CompactionResult | undefined> {
	const startedAt = Date.now();
	const safeEvent = parseBeforeCompactEvent(event);
	if (!safeEvent) {
		appendLifecycleDiagnostic(state.lifecycleDiagnostics, {
			triggerReason: "incompatible-event",
			terminalState: "skipped",
			startedAt,
			fallbackCategory: "incompatible-event",
		});
		notify(
			ctx,
			"Autocompact v2: received an incompatible compaction event; using default compaction.",
			"warning",
		);
		return;
	}

	const { preparation, signal, customInstructions, reason, willRetry } = safeEvent;
	const model = ctx.model;
	if (!model) {
		appendLifecycleDiagnostic(state.lifecycleDiagnostics, {
			triggerReason: reason,
			terminalState: "skipped",
			startedAt,
			fallbackCategory: "missing-model",
		});
		notify(
			ctx,
			"Autocompact v2: no active model; falling back to default compaction.",
			"warning",
		);
		return;
	}

	let auth: Awaited<ReturnType<SummaryContextPort["modelRegistry"]["getApiKeyAndHeaders"]>>;
	try {
		auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	} catch (error) {
		appendLifecycleDiagnostic(state.lifecycleDiagnostics, {
			triggerReason: reason,
			terminalState: "failed",
			startedAt,
			fallbackCategory: "unexpected-error",
		});
		notify(
			ctx,
			`Autocompact v2 failed to resolve auth; using default compaction: ${error instanceof Error ? error.message : String(error)}`,
			"error",
		);
		return;
	}
	if (!auth.ok || !auth.apiKey) {
		appendLifecycleDiagnostic(state.lifecycleDiagnostics, {
			triggerReason: reason,
			terminalState: "skipped",
			startedAt,
			fallbackCategory: "missing-auth",
		});
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
	if (allMessages.length === 0) {
		appendLifecycleDiagnostic(state.lifecycleDiagnostics, {
			triggerReason: reason,
			terminalState: "skipped",
			startedAt,
			fallbackCategory: "empty-input",
		});
		return;
	}

	const previousFiles = parseFileLists(preparation.previousSummary);
	const currentFiles = computeFileLists(preparation.fileOps);
	const mergedFiles = mergeFileLists(previousFiles, currentFiles);
	const plan = buildCompactionPlan({
		preparation,
		state,
		reason,
		willRetry,
		customInstructions,
		fileLists: mergedFiles,
	});

	try {
		const firstAttempt = await runSummaryAttemptPipeline({
			preparation,
			state,
			plan,
			fileLists: mergedFiles,
			customInstructions,
			reason,
			willRetry,
			model,
			auth,
			signal,
			onNotify: (message) => notify(ctx, message, "info"),
		});
		const retried = shouldRetrySummaryFailure(firstAttempt);
		const finalAttempt = retried
			? await runSummaryAttemptPipeline({
					preparation,
					state,
					plan,
					fileLists: mergedFiles,
					customInstructions,
					reason,
					willRetry,
					model,
					auth,
					signal,
					forceMode: "aggressive",
					onNotify: (message) => notify(ctx, message, "info"),
				})
			: firstAttempt;
		if (finalAttempt.ok) {
			appendLifecycleDiagnostic(state.lifecycleDiagnostics, {
				triggerReason: reason,
				terminalState: "completed",
				startedAt,
				retryCount: retried ? 1 : 0,
			});
			return finalAttempt.compaction;
		}

		appendLifecycleDiagnostic(state.lifecycleDiagnostics, {
			triggerReason: reason,
			terminalState: "fallback",
			startedAt,
			retryCount: retried ? 1 : 0,
			fallbackCategory: fallbackCategoryFor(finalAttempt),
			violatedInvariants: finalAttempt.violatedInvariants,
		});
		notifySummaryFailure(ctx, finalAttempt);
		return;
	} catch (error) {
		const aborted = signal?.aborted === true;
		appendLifecycleDiagnostic(state.lifecycleDiagnostics, {
			triggerReason: reason,
			terminalState: aborted ? "fallback" : "failed",
			startedAt,
			fallbackCategory: aborted ? "aborted" : "unexpected-error",
		});
		const message = error instanceof Error ? error.message : String(error);
		if (!aborted) notify(ctx, `Autocompact v2 failed: ${message}`, "error");
		return;
	}
}

function fallbackCategoryFor(
	result: SummaryAttemptFailure,
): LifecycleFallbackCategory {
	switch (result.reason) {
		case "empty":
			return "empty-summary";
		case "invalid-structure":
		case "too-long":
			return "invalid-summary";
		case "invalid-result":
			return "invalid-result";
		case "verification-failed":
			return "verification-failed";
		default:
			return result.reason;
	}
}

function notifySummaryFailure(
	ctx: SummaryContextPort,
	result: SummaryAttemptResult,
): void {
	if (result.ok || result.reason === "aborted") return;
	notify(
		ctx,
		fallbackMessageForSummaryFailure(result),
		result.reason === "provider-error" ? "error" : "warning",
	);
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
