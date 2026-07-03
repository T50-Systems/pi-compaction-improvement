import {
	convertToLlm,
	serializeConversation,
} from "@earendil-works/pi-coding-agent";
import {
	buildSummarizationPrompt,
	resolveSummaryMode,
	stripAutocompactDirectives,
	type SummaryMode,
} from "../prompt.ts";
import type { AutoCompactState } from "../state.ts";
import type {
	SafeCompactionPreparation,
	SafeCompactionReason,
} from "./types.ts";

export type SummaryReason = SafeCompactionReason;

export function resolveSummaryReason(state: AutoCompactState): SummaryReason {
	if (state.lastCompactionReason === "manual-now") return "manual";
	if (state.lastCompactionReason === "emergency-near-limit") return "overflow";
	return "threshold";
}

function serializeMessages(messages: unknown[]): string {
	return serializeConversation(convertToLlm(messages as never));
}

function safeTaggedBlock(tag: string, value: string): string {
	const escaped = value.replaceAll(`</${tag}>`, `<\\/${tag}>`);
	return `<${tag}>\n${escaped}\n</${tag}>`;
}

export function buildSummaryRequest(input: {
	preparation: SafeCompactionPreparation;
	state: AutoCompactState;
	customInstructions?: string;
	reason?: SummaryReason;
	willRetry?: boolean;
	forceMode?: SummaryMode;
}): {
	allMessages: unknown[];
	promptText: string;
	reason: SummaryReason;
	mode: SummaryMode;
} {
	const { preparation, state, customInstructions } = input;
	const allMessages = [
		...preparation.messagesToSummarize,
		...preparation.turnPrefixMessages,
	];
	const reason = input.reason ?? resolveSummaryReason(state);
	const mode =
		input.forceMode ??
		resolveSummaryMode({
			reason,
			willRetry: input.willRetry ?? false,
			customInstructions,
		});
	const blocks = [
		safeTaggedBlock(
			"messages-to-summarize",
			serializeMessages(preparation.messagesToSummarize),
		),
		preparation.turnPrefixMessages.length > 0
			? safeTaggedBlock(
					"retained-turn-prefix",
					serializeMessages(preparation.turnPrefixMessages),
				)
			: "",
		preparation.previousSummary
			? safeTaggedBlock("previous-summary", preparation.previousSummary)
			: "",
		safeTaggedBlock(
			"compaction-context",
			[
				`reason=${reason}`,
				`mode=${mode}`,
				`willRetry=${String(input.willRetry ?? false)}`,
				`splitTurn=${String(preparation.turnPrefixMessages.length > 0)}`,
				`trigger=${state.lastCompactionReason ?? "unknown"}`,
			].join("\n"),
		),
		buildSummarizationPrompt({
			mode,
			previousSummary: Boolean(preparation.previousSummary),
			customInstructions: stripAutocompactDirectives(customInstructions),
			hasSplitTurn: preparation.turnPrefixMessages.length > 0,
		}),
	]
		.filter(Boolean)
		.join("\n\n");
	return { allMessages, promptText: blocks, reason, mode };
}

export function calculateSummaryMaxTokens(input: {
	reserveTokens: number;
	modelMaxTokens: number;
	mode?: SummaryMode;
}): number {
	const reserveRatio = input.mode === "aggressive" ? 0.55 : 0.8;
	return Math.min(
		Math.floor(reserveRatio * input.reserveTokens),
		input.modelMaxTokens > 0 ? input.modelMaxTokens : Number.POSITIVE_INFINITY,
	);
}
