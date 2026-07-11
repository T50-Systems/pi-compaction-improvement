export type SummaryMode = "standard" | "focused" | "aggressive";

export interface ResolveSummaryModeInput {
	reason: "manual" | "threshold" | "overflow";
	willRetry: boolean;
	customInstructions?: string;
}

export interface BuildPromptInput {
	mode: SummaryMode;
	previousSummary: boolean;
	customInstructions?: string;
	hasSplitTurn: boolean;
}

const MODE_MARKER = /\[AUTOCOMPACT_MODE=(standard|focused|aggressive)\]/i;
const REASON_MARKER = /\[AUTOCOMPACT_REASON=([^\]]+)\]/gi;

const TEMPLATE = `## Goal
[What the user is trying to accomplish]

## Active Goal Context
- Objective: [Active objective if one exists; otherwise (none)]
- Acceptance: [Acceptance criteria, success criteria, or definition of done if present]
- Current: [Current goal/task state if present]
- Blocked: [Goal-level blockers if present]

## Constraints & Preferences
- [Requirements, constraints, or preferences from the user]
- [(none) if there are none]

## Progress
### Done
- [x] [Completed work]

### In Progress
- [ ] [Current work]

### Blocked
- [Concrete blockers that currently prevent progress]

## Key Decisions
- **[Decision]**: [Why it was made]

## Discarded Hypotheses
- [Rejected explanation or path, and why it was rejected]

## Risks
- [Important unresolved risk, uncertainty, or likely failure mode]

## Immediate Next Action
1. [Exactly one concrete next step the next agent should do first]

## Continuation Contract
- Resume automatically after compaction: [yes/no]
- If no, ask the user exactly this: [specific question or approval needed]

## Next Steps
1. [Ordered follow-up actions after the immediate next action]

## Critical Context
- [Exact file paths, functions, commands, errors, or facts needed to continue]
- [(none) if not applicable]`;

export function extractForcedMode(
	customInstructions?: string,
): SummaryMode | undefined {
	const match = MODE_MARKER.exec(customInstructions ?? "");
	return match?.[1]?.toLowerCase() as SummaryMode | undefined;
}

export function stripAutocompactDirectives(
	customInstructions?: string,
): string | undefined {
	const cleaned = (customInstructions ?? "")
		.replace(MODE_MARKER, "")
		.replace(REASON_MARKER, "")
		.trim();
	return cleaned || undefined;
}

export function resolveSummaryMode(
	input: ResolveSummaryModeInput,
): SummaryMode {
	const forcedMode = extractForcedMode(input.customInstructions);
	if (forcedMode) return forcedMode;
	if (input.reason === "overflow" || input.willRetry) return "aggressive";
	if (stripAutocompactDirectives(input.customInstructions)) return "focused";
	return "standard";
}

export function buildSummarizationPrompt(input: BuildPromptInput): string {
	const intro = input.previousSummary
		? "Update the existing structured summary using the new conversation material. Preserve still-relevant prior context, move completed items into Done, and refresh the current action state."
		: "Create a structured context checkpoint summary that another agent can use to continue the work with minimal re-reading.";

	const commonRules = [
		"Prefer conclusions over chronology.",
		"Preserve exact file paths, function names, commands, and error messages when they matter.",
		"Preserve any active objective, goal, plan, acceptance criteria, success criteria, progress state, blockers, and next action found in the conversation, regardless of which extension or tool produced it.",
		"Treat goal/progress blocks as durable continuation context: copy their current meaning into Active Goal Context, Progress, Blocked, Immediate Next Action, and Critical Context as appropriate.",
		"Do not mention or depend on any specific goal extension; summarize goal-like context using neutral wording.",
		"Do not copy long logs, full tool outputs, command result listings, or file count tables; keep only the command/conclusion/error and say that large output was omitted.",
		"Do not reproduce full todo/task snapshots. Condense them to counts plus the active, pending, blocked, and immediate next items; omit completed rows unless a specific completed item is needed as evidence.",
		"If previous context contains a huge task list or already-truncated output, summarize it as compact state such as 'Completed: 85/87 tasks summarized' and preserve the one current next action.",
		"Record discarded hypotheses only when they prevent repeated work.",
		"Separate immediate blockers from broader risks.",
		"Immediate Next Action must contain exactly one concrete first step.",
		"Continuation Contract must say whether the agent should resume automatically after compaction.",
		"Set Resume automatically to yes unless progress is blocked by missing user input, approval, credentials, or an external dependency.",
		"If Resume automatically is yes, phrase the next action as an executable instruction, not a question or status recap.",
		"Keep the summary concise but operationally complete.",
	];

	const budgetRules = [
		"Budget by section: keep Goal and Continuation Contract short; spend detail on Critical Context, Blocked, and Immediate Next Action.",
		"Do not let narrative history crowd out exact commands, paths, errors, pending validation, or the next executable step.",
		input.mode === "aggressive"
			? "Aggressive mode budget: minimize Done and Key Decisions; prioritize Blocked, Critical Context, Immediate Next Action, and Resume automatically."
			: "Standard mode budget: preserve enough Done and Key Decisions to prevent repeated work, but avoid chronological narration.",
	];

	const modeRules: Record<SummaryMode, string[]> = {
		standard: [
			"Optimize for balanced continuity: enough detail to resume work, without narrating the full history.",
		],
		focused: [
			"Give extra weight to the current task, current blockers, and the user's custom focus instructions.",
		],
		aggressive: [
			"Compress aggressively for recovery from context pressure while preserving only the information needed to continue safely.",
			"Minimize narration and repetition.",
		],
	};

	const splitTurnRule = input.hasSplitTurn
		? [
				"Part of the current turn is retained outside this summary. Capture only the prefix context needed to understand the kept recent suffix.",
			]
		: [];

	const cleanedInstructions = stripAutocompactDirectives(
		input.customInstructions,
	);

	const customFocus = cleanedInstructions
		? [`Additional focus: ${cleanedInstructions}`]
		: [];

	return [
		intro,
		"",
		"Rules:",
		...commonRules.map((rule) => `- ${rule}`),
		...modeRules[input.mode].map((rule) => `- ${rule}`),
		...budgetRules.map((rule) => `- ${rule}`),
		...splitTurnRule.map((rule) => `- ${rule}`),
		...customFocus.map((rule) => `- ${rule}`),
		"",
		"Use this exact structure:",
		"",
		TEMPLATE,
	].join("\n");
}
