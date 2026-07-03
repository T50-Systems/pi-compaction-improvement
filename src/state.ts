import type { AutoCompactConfig, ConfigLoadResult } from "./config.ts";
import type { AutoCompactDecisionReason, PolicyEvaluation } from "./policy.ts";

export type CompactionPhase =
	| "idle"
	| "requested"
	| "scheduled"
	| "triggering"
	| "compacting"
	| "completed"
	| "failed"
	| "cancelled";

export interface AutoCompactState {
	previousTokens: number | null;
	lastTriggerTurn: number | null;
	lastSuccessfulCompactTurn: number | null;
	compactInFlight: boolean;
	compactionPhase: CompactionPhase;
	consecutiveGrowthTurns: number;
	lastDecisionReason: AutoCompactDecisionReason;
	lastCompactionReason: string | null;
	lastCompactionSource: "extension" | "core" | null;
	compactionCount: number;
}

export interface StatusSnapshot {
	config: AutoCompactConfig;
	configInfo: ConfigLoadResult;
	currentTokens: number | null;
	contextWindow: number | null;
	percent: number | null;
	state: AutoCompactState;
	evaluation?: PolicyEvaluation;
}

export function createInitialState(): AutoCompactState {
	return {
		previousTokens: null,
		lastTriggerTurn: null,
		lastSuccessfulCompactTurn: null,
		compactInFlight: false,
		compactionPhase: "idle",
		consecutiveGrowthTurns: 0,
		lastDecisionReason: "none",
		lastCompactionReason: null,
		lastCompactionSource: null,
		compactionCount: 0,
	};
}

export function noteEvaluation(
	state: AutoCompactState,
	evaluation: PolicyEvaluation,
): void {
	state.consecutiveGrowthTurns = evaluation.nextConsecutiveGrowthTurns;
	state.lastDecisionReason = evaluation.decision.reason;
}

export function noteObservedTokens(
	state: AutoCompactState,
	currentTokens: number,
): void {
	state.previousTokens = currentTokens;
}

export function noteCompactionRequested(
	state: AutoCompactState,
	turnIndex: number,
	reason: string,
): void {
	state.compactInFlight = true;
	state.compactionPhase = "requested";
	state.lastTriggerTurn = turnIndex;
	state.lastCompactionReason = reason;
}

export function noteCompactionScheduled(state: AutoCompactState): void {
	state.compactInFlight = true;
	state.compactionPhase = "scheduled";
}

export function noteCompactionTriggering(state: AutoCompactState): void {
	state.compactInFlight = true;
	state.compactionPhase = "triggering";
}

export function noteCompactionCompleted(
	state: AutoCompactState,
	turnIndex: number | null,
	source: "extension" | "core",
	reason: string,
): void {
	state.compactInFlight = false;
	state.compactionPhase = "completed";
	state.previousTokens = null;
	state.consecutiveGrowthTurns = 0;
	state.lastSuccessfulCompactTurn = turnIndex;
	state.lastCompactionReason = reason;
	state.lastCompactionSource = source;
	state.compactionCount += 1;
}

export function noteCompactionFailed(state: AutoCompactState): void {
	state.compactInFlight = false;
	state.compactionPhase = "failed";
}

export function noteCompactionCancelled(state: AutoCompactState): void {
	state.compactInFlight = false;
	state.compactionPhase = "cancelled";
}
