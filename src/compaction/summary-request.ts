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

const TURN_PREFIX_SUMMARIZATION_PROMPT = `This is the PREFIX of a turn that was too large to keep. The SUFFIX (recent work) is retained intact outside this summary.

Summarize the prefix to provide context for the retained suffix.

Use this exact structure:

## Original Request
[What did the user ask for in this turn?]

## Early Progress
- [Key decisions and work done in the prefix]

## Context for Suffix
- [Information needed to understand the retained recent work]

Be concise. Focus only on what is needed to understand the kept suffix.`;

export function resolveSummaryReason(state: AutoCompactState): SummaryReason {
	if (state.lastCompactionReason === "manual-now") return "manual";
	if (state.lastCompactionReason === "emergency-near-limit") return "overflow";
	return "threshold";
}

function serializeMessages(messages: unknown[]): string {
	return serializeConversation(convertToLlm(messages as never));
}

function safeTaggedBlock(tag: string, value: string): string {
	const escaped = value.split(`</${tag}>`).join(`<\\/${tag}>`);
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
	const allMessages = preparation.messagesToSummarize;
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

export function buildTurnPrefixSummaryRequest(input: {
	preparation: SafeCompactionPreparation;
}): { allMessages: unknown[]; promptText: string } {
	return {
		allMessages: input.preparation.turnPrefixMessages,
		promptText: [
			safeTaggedBlock(
				"turn-prefix-messages",
				serializeMessages(input.preparation.turnPrefixMessages),
			),
			TURN_PREFIX_SUMMARIZATION_PROMPT,
		].join("\n\n"),
	};
}

export function formatSplitTurnSummary(input: {
	historySummary: string;
	turnPrefixSummary: string;
}): string {
	return `${input.historySummary.trim()}\n\n---\n\n**Turn Context (split turn):**\n\n${input.turnPrefixSummary.trim()}`;
}

export function buildNoPriorHistorySummary(): string {
	return [
		"## Goal",
		"Continue the retained split turn.",
		"",
		"## Constraints & Preferences",
		"- Preserve context needed for the retained suffix.",
		"",
		"## Progress",
		"### Done",
		"- [x] No earlier history was compacted before this split-turn prefix.",
		"",
		"### In Progress",
		"- [ ] Continue from the retained suffix of the current turn.",
		"",
		"### Blocked",
		"- None.",
		"",
		"## Key Decisions",
		"- Preserve split-turn prefix context separately.",
		"",
		"## Discarded Hypotheses",
		"- None.",
		"",
		"## Risks",
		"- Retained suffix depends on the split-turn context below.",
		"",
		"## Immediate Next Action",
		"1. Continue from the retained recent suffix of the current turn.",
		"",
		"## Continuation Contract",
		"- Resume automatically after compaction: yes",
		"- If no, ask the user exactly this: N/A",
		"",
		"## Next Steps",
		"1. Use the Turn Context section to understand the retained suffix.",
		"",
		"## Critical Context",
		"- No prior history summary was generated; only split-turn prefix context follows.",
	].join("\n");
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

export function calculateTurnPrefixMaxTokens(input: {
	reserveTokens: number;
	modelMaxTokens: number;
}): number {
	return Math.min(
		Math.floor(0.5 * input.reserveTokens),
		input.modelMaxTokens > 0 ? input.modelMaxTokens : Number.POSITIVE_INFINITY,
	);
}
