import {
	noteCompactionFailed,
	noteCompactionTriggering,
	type AutoCompactState,
} from "../state.ts";
import type { SchedulerContextPort } from "./ports.ts";
import { notify } from "./telemetry.ts";

export function triggerScheduledCompaction(
	ctx: SchedulerContextPort,
	state: AutoCompactState,
	customInstructions?: string,
): void {
	try {
		if (ctx.signal) {
			noteCompactionFailed(state);
			notify(
				ctx,
				"Autocompact v2 skipped because the session still has an active abort signal.",
				"warning",
			);
			return;
		}
		noteCompactionTriggering(state);
		ctx.compact({
			customInstructions,
			onComplete: () => {
				state.compactInFlight = false;
				state.compactionPhase = "completed";
			},
			onError: (error) => {
				noteCompactionFailed(state);
				notifyTriggerFailure(ctx, error.message);
			},
		});
	} catch (error) {
		noteCompactionFailed(state);
		notifyTriggerFailure(
			ctx,
			error instanceof Error ? error.message : String(error),
		);
	}
}

function notifyTriggerFailure(
	ctx: SchedulerContextPort,
	message: string,
): void {
	if (
		/Cannot read properties of undefined \(reading ['"]signal['"]\)/.test(
			message,
		)
	) {
		notify(
			ctx,
			"Autocompact v2 skipped because another compaction was already in progress.",
			"warning",
		);
		return;
	}

	notify(ctx, `Autocompact v2 trigger failed: ${message}`, "error");
}
