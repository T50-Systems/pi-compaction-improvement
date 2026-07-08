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
import { estimateTokens } from "./summary-size-policy.ts";
import type {
	SafeCompactionPreparation,
	SafeCompactionReason,
} from "./types.ts";

export type SummaryReason = SafeCompactionReason;

const TOKEN_TO_CHAR_RATIO = 4;
const SUMMARY_PROMPT_SAFETY_TOKENS = 1_024;
const MIN_SERIALIZED_MESSAGE_TOKENS = 512;

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

function serializeMessages(messages: unknown[], maxTokens?: number): string {
	const serialized = serializeConversation(convertToLlm(messages as never));
	return truncateEstimatedTokens(serialized, maxTokens);
}

function safeTaggedBlock(tag: string, value: string): string {
	const escaped = value.split(`</${tag}>`).join(`<\\/${tag}>`);
	return `<${tag}>\n${escaped}\n</${tag}>`;
}

function truncateEstimatedTokens(text: string, maxTokens?: number): string {
	if (maxTokens === undefined || maxTokens <= 0) return text;
	const estimated = estimateTokens(text);
	if (estimated <= maxTokens) return text;

	const marker = `\n\n[... omitted approximately ${estimated - maxTokens} tokens to keep the compaction request within the model context window ...]\n\n`;
	const maxChars = Math.max(0, maxTokens * TOKEN_TO_CHAR_RATIO - marker.length);
	if (maxChars <= 0) return marker.trim();

	const headChars = Math.floor(maxChars * 0.35);
	const tailChars = Math.max(0, maxChars - headChars);
	return `${text.slice(0, headChars).trimEnd()}${marker}${text.slice(-tailChars).trimStart()}`;
}

export function calculatePromptMaxTokens(input: {
	modelContextWindow?: number;
	outputMaxTokens: number;
}): number | undefined {
	if (!input.modelContextWindow || input.modelContextWindow <= 0) return undefined;
	return Math.max(
		MIN_SERIALIZED_MESSAGE_TOKENS,
		input.modelContextWindow - input.outputMaxTokens - SUMMARY_PROMPT_SAFETY_TOKENS,
	);
}

function allocateVariablePromptBudgets(input: {
	previousSummary?: string;
	fixedPromptText: string;
	promptMaxTokens?: number;
}): { messagesMaxTokens?: number; previousSummaryMaxTokens?: number } {
	if (input.promptMaxTokens === undefined) return {};

	const fixedTokens = estimateTokens(input.fixedPromptText);
	const variableBudget = input.promptMaxTokens - fixedTokens;
	if (variableBudget <= MIN_SERIALIZED_MESSAGE_TOKENS) {
		return {
			messagesMaxTokens: Math.max(0, variableBudget),
			previousSummaryMaxTokens: 0,
		};
	}

	const previousTokens = input.previousSummary
		? estimateTokens(input.previousSummary)
		: 0;
	const previousSummaryMaxTokens = Math.min(
		previousTokens,
		Math.floor(variableBudget * 0.25),
	);
	const messagesMaxTokens = Math.max(
		MIN_SERIALIZED_MESSAGE_TOKENS,
		variableBudget - previousSummaryMaxTokens,
	);

	return { messagesMaxTokens, previousSummaryMaxTokens };
}

export function buildSummaryRequest(input: {
	preparation: SafeCompactionPreparation;
	state: AutoCompactState;
	customInstructions?: string;
	reason?: SummaryReason;
	willRetry?: boolean;
	forceMode?: SummaryMode;
	promptMaxTokens?: number;
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
	const compactionContext = safeTaggedBlock(
		"compaction-context",
		[
			`reason=${reason}`,
			`mode=${mode}`,
			`willRetry=${String(input.willRetry ?? false)}`,
			`splitTurn=${String(preparation.turnPrefixMessages.length > 0)}`,
			`trigger=${state.lastCompactionReason ?? "unknown"}`,
		].join("\n"),
	);
	const promptInstructions = buildSummarizationPrompt({
		mode,
		previousSummary: Boolean(preparation.previousSummary),
		customInstructions: stripAutocompactDirectives(customInstructions),
		hasSplitTurn: preparation.turnPrefixMessages.length > 0,
	});
	const fixedPromptText = [compactionContext, promptInstructions].join("\n\n");
	const budgets = allocateVariablePromptBudgets({
		previousSummary: preparation.previousSummary,
		fixedPromptText,
		promptMaxTokens: input.promptMaxTokens,
	});
	const messagesBlock = safeTaggedBlock(
		"messages-to-summarize",
		serializeMessages(preparation.messagesToSummarize, budgets.messagesMaxTokens),
	);
	const previousSummaryBlock = preparation.previousSummary
		? safeTaggedBlock(
				"previous-summary",
				truncateEstimatedTokens(
					preparation.previousSummary,
					budgets.previousSummaryMaxTokens,
				),
			)
		: "";
	let promptText = [
		messagesBlock,
		previousSummaryBlock,
		compactionContext,
		promptInstructions,
	]
		.filter(Boolean)
		.join("\n\n");

	promptText = truncateEstimatedTokens(promptText, input.promptMaxTokens);
	return { allMessages, promptText, reason, mode };
}

export function buildTurnPrefixSummaryRequest(input: {
	preparation: SafeCompactionPreparation;
	promptMaxTokens?: number;
}): { allMessages: unknown[]; promptText: string } {
	const promptInstructions = TURN_PREFIX_SUMMARIZATION_PROMPT;
	const fixedTokens = estimateTokens(promptInstructions);
	const messagesMaxTokens =
		input.promptMaxTokens === undefined
			? undefined
			: Math.max(0, input.promptMaxTokens - fixedTokens);
	let promptText = [
		safeTaggedBlock(
			"turn-prefix-messages",
			serializeMessages(input.preparation.turnPrefixMessages, messagesMaxTokens),
		),
		promptInstructions,
	].join("\n\n");

	promptText = truncateEstimatedTokens(promptText, input.promptMaxTokens);
	return {
		allMessages: input.preparation.turnPrefixMessages,
		promptText,
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
