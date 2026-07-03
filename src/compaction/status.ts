import type { StatusContextPort } from "./ports.ts";
import { loadEffectiveConfig } from "../config.ts";
import { decideAutoCompact } from "../policy.ts";
import { formatStatusLine } from "../state-formatting.ts";
import type { AutoCompactState, StatusSnapshot } from "../state.ts";

export const STATUS_KEY = "pi-autocompact-v2";
export const STATUS_WIDGET_KEY = "pi-autocompact-v2-report";

export async function buildStatusSnapshot(
	ctx: StatusContextPort,
	state: AutoCompactState,
): Promise<StatusSnapshot> {
	const configInfo = await loadEffectiveConfig(ctx.cwd, ctx.isProjectTrusted());
	const usage = ctx.getContextUsage();
	const evaluation =
		usage?.tokens === null || usage?.tokens === undefined
			? undefined
			: decideAutoCompact({
					config: configInfo.config,
					currentTokens: usage.tokens,
					previousTokens: state.previousTokens,
					contextWindow: usage.contextWindow,
					turnIndex: state.lastTriggerTurn ?? 0,
					consecutiveGrowthTurns: state.consecutiveGrowthTurns,
					compactInFlight: state.compactInFlight,
					lastTriggerTurn: state.lastTriggerTurn,
					toolResultTokens: 0,
					toolResultsCount: 0,
				});

	return {
		config: configInfo.config,
		configInfo,
		currentTokens: usage?.tokens ?? null,
		contextWindow: usage?.contextWindow ?? null,
		percent: usage?.percent ?? null,
		state,
		evaluation,
	};
}

export function applyStatus(
	ctx: StatusContextPort,
	snapshot: StatusSnapshot,
): void {
	if (!snapshot.config.showStatus) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}
	ctx.ui.setStatus(STATUS_KEY, formatStatusLine(snapshot));
}

export function setStatusReportWidget(
	ctx: StatusContextPort,
	report?: string,
): void {
	ctx.ui.setWidget(STATUS_WIDGET_KEY, report ? report.split("\n") : undefined, {
		placement: "belowEditor",
	});
}
