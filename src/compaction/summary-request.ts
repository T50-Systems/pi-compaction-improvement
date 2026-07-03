import {
	convertToLlm,
	serializeConversation,
} from "@earendil-works/pi-coding-agent";
import {
	buildSummarizationPrompt,
	resolveSummaryMode,
	stripAutocompactDirectives,
} from "../prompt.ts";
import type { AutoCompactState } from "../state.ts";
import type { SafeCompactionPreparation } from "./types.ts";

export type SummaryReason = "manual" | "overflow" | "threshold";

export function resolveSummaryReason(state: AutoCompactState): SummaryReason {
	if (state.lastCompactionReason === "manual-now") return "manual";
	if (state.lastCompactionReason === "emergency-near-limit") return "overflow";
	return "threshold";
}

export function buildSummaryRequest(input: {
	preparation: SafeCompactionPreparation;
	state: AutoCompactState;
	customInstructions?: string;
}): { allMessages: unknown[]; promptText: string; reason: SummaryReason } {
	const { preparation, state, customInstructions } = input;
	const allMessages = [
		...preparation.messagesToSummarize,
		...preparation.turnPrefixMessages,
	];
	const reason = resolveSummaryReason(state);
	const mode = resolveSummaryMode({
		reason,
		willRetry: false,
		customInstructions,
	});
	const promptText = [
		`<conversation>\n${serializeConversation(convertToLlm(allMessages as never))}\n</conversation>`,
		preparation.previousSummary
			? `<previous-summary>\n${preparation.previousSummary}\n</previous-summary>`
			: "",
		`<compaction-context>\nreason=${reason}\nmode=${mode}\nsplitTurn=${String(preparation.turnPrefixMessages.length > 0)}\ntrigger=${state.lastCompactionReason ?? "unknown"}\n</compaction-context>`,
		buildSummarizationPrompt({
			mode,
			previousSummary: Boolean(preparation.previousSummary),
			customInstructions: stripAutocompactDirectives(customInstructions),
			hasSplitTurn: preparation.turnPrefixMessages.length > 0,
		}),
	]
		.filter(Boolean)
		.join("\n\n");
	return { allMessages, promptText, reason };
}

export function calculateSummaryMaxTokens(input: {
	reserveTokens: number;
	modelMaxTokens: number;
}): number {
	return Math.min(
		Math.floor(0.8 * input.reserveTokens),
		input.modelMaxTokens > 0 ? input.modelMaxTokens : Number.POSITIVE_INFINITY,
	);
}
