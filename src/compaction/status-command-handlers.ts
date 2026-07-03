import type { AutoCompactState } from "../state.ts";
import { formatStatusLine, formatStatusReport } from "../state-formatting.ts";
import type { CommandContextPort } from "./ports.ts";
import {
	applyStatus,
	buildStatusSnapshot,
	setStatusReportWidget,
} from "./status.ts";
import { notify } from "./telemetry.ts";

export async function handleStatusCommand(
	args: string,
	ctx: CommandContextPort,
	state: AutoCompactState,
): Promise<void> {
	if (args.trim() === "clear") {
		setStatusReportWidget(ctx);
		notify(ctx, "Autocompact v2 status widget cleared.", "info");
		return;
	}
	await showStatus(ctx, state);
}

export async function showStatus(
	ctx: CommandContextPort,
	state: AutoCompactState,
): Promise<void> {
	const snapshot = await buildStatusSnapshot(ctx, state);
	applyStatus(ctx, snapshot);
	const report = formatStatusReport(snapshot);
	setStatusReportWidget(ctx, report);
	notify(
		ctx,
		`Autocompact v2 status refreshed: ${formatStatusLine(snapshot)}`,
		"info",
	);
}
