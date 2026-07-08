import { noteCompactionFailed, noteCompactionScheduled } from "../state.ts";
import type { AutoCompactState } from "../state.ts";
import { triggerScheduledCompaction } from "./compaction-trigger.ts";
import type { SchedulerContextPort } from "./ports.ts";
import { notify } from "./telemetry.ts";

export interface ScheduledAutocompact {
	timeout: ReturnType<typeof setTimeout> | undefined;
	turnIndex: number | null;
	reason: string | null;
	attempts: number;
	generation: number;
}

export const AUTOCOMPACT_INITIAL_DEFER_MS = 250;
export const AUTOCOMPACT_DEFER_MS = 1_000;
export const AUTOCOMPACT_MAX_IDLE_WAIT_MS = 10 * 60 * 1_000;
export const MAX_AUTOCOMPACT_DEFER_ATTEMPTS = Math.ceil(
	AUTOCOMPACT_MAX_IDLE_WAIT_MS / AUTOCOMPACT_DEFER_MS,
);

export function createScheduledAutocompact(): ScheduledAutocompact {
	return {
		timeout: undefined,
		turnIndex: null,
		reason: null,
		attempts: 0,
		generation: 0,
	};
}

export function scheduleAutocompact(
	ctx: SchedulerContextPort,
	state: AutoCompactState,
	schedule: ScheduledAutocompact,
	options: { turnIndex: number; reason: string; customInstructions?: string },
): void {
	cancelScheduledAutocompact(schedule);
	const generation = schedule.generation + 1;
	schedule.generation = generation;
	schedule.turnIndex = options.turnIndex;
	schedule.reason = options.reason;
	schedule.attempts = 0;
	noteCompactionScheduled(state);

	const run = () => {
		schedule.timeout = undefined;
		if (!isCurrentScheduledCompaction(state, schedule, options, generation))
			return;

		if (!ctx.isIdle() || ctx.hasPendingMessages() || ctx.signal) {
			if (schedule.attempts < MAX_AUTOCOMPACT_DEFER_ATTEMPTS) {
				schedule.attempts += 1;
				schedule.timeout = setTimeout(run, AUTOCOMPACT_DEFER_MS);
				return;
			}

			noteCompactionFailed(state);
			notify(
				ctx,
				"Autocompact v2 skipped because the session never became idle after agent completion.",
				"warning",
			);
			return;
		}

		triggerScheduledCompaction(ctx, state, options.customInstructions);
	};

	schedule.timeout = setTimeout(run, AUTOCOMPACT_INITIAL_DEFER_MS);
}

export function cancelScheduledAutocompact(
	schedule: ScheduledAutocompact,
): void {
	if (schedule.timeout) clearTimeout(schedule.timeout);
	schedule.timeout = undefined;
	schedule.generation += 1;
}

export function isCurrentScheduledCompaction(
	state: AutoCompactState,
	schedule: ScheduledAutocompact,
	options: { turnIndex: number; reason: string },
	generation: number,
): boolean {
	return (
		state.compactInFlight &&
		schedule.generation === generation &&
		schedule.turnIndex === options.turnIndex &&
		schedule.reason === options.reason &&
		state.lastTriggerTurn === options.turnIndex &&
		state.lastCompactionReason === options.reason
	);
}
