import {
	createInitialState,
	noteCompactionCancelled,
	noteCompactionCompleted,
	noteCompactionFailed,
	noteCompactionRequested,
	noteCompactionScheduled,
	noteCompactionTriggering,
	noteEvaluation,
	noteObservedTokens,
} from "../state.ts";
import type { AutoCompactState, CompactionPhase } from "./types.ts";

function isActivePhase(phase: CompactionPhase): boolean {
	return phase === "requested" || phase === "scheduled" || phase === "triggering";
}

export function setCompactionPhase(state: AutoCompactState, phase: CompactionPhase): void {
	state.compactionPhase = phase;
	state.compactInFlight = isActivePhase(phase);
}

export function isCompactionActive(state: AutoCompactState): boolean {
	return isActivePhase(state.compactionPhase);
}

export {
	createInitialState,
	noteCompactionCancelled,
	noteCompactionCompleted,
	noteCompactionFailed,
	noteCompactionRequested,
	noteCompactionScheduled,
	noteCompactionTriggering,
	noteEvaluation,
	noteObservedTokens,
};
