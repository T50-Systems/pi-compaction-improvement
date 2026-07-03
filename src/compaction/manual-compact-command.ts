import { buildAutoCompactInstructions } from "../policy.ts";
import { noteCompactionFailed, type AutoCompactState } from "../state.ts";
import type { CommandContextPort } from "./ports.ts";
import { notify } from "./telemetry.ts";

export async function handleManualCompactCommand(
	args: string,
	ctx: CommandContextPort,
	state: AutoCompactState,
): Promise<void> {
	if (state.compactInFlight) {
		notify(
			ctx,
			"Autocompact v2 already has a compaction in flight.",
			"warning",
		);
		return;
	}
	const instructions = buildManualNowInstructions(args);
	state.compactInFlight = true;
	state.lastCompactionReason = "manual-now";
	ctx.compact({
		customInstructions: instructions,
		onComplete: () => {
			state.compactInFlight = false;
		},
		onError: () => {
			noteCompactionFailed(state);
		},
	});
	notify(ctx, "Autocompact v2 requested an immediate compaction.", "info");
}

function buildManualNowInstructions(args: string): string | undefined {
	const trimmed = args.trim();
	if (!trimmed)
		return buildAutoCompactInstructions("soft-threshold", "standard");
	return `${buildAutoCompactInstructions("soft-threshold", "standard")}\n\n${trimmed}`;
}
