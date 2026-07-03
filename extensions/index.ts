import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatConfigSummary, loadEffectiveConfig } from "../src/config.ts";
import { decideAutoCompact } from "../src/policy.ts";
import {
	createInitialState,
	noteCompactionCompleted,
	noteCompactionCancelled,
	noteCompactionRequested,
	noteEvaluation,
	noteObservedTokens,
	type StatusSnapshot,
} from "../src/state.ts";
import { estimateToolResultTokens } from "../src/tool-results.ts";
import { isRecord, isToolResultLike } from "../src/compaction/event-guard.ts";
import {
	applyStatus,
	buildStatusSnapshot,
	setStatusReportWidget,
	STATUS_KEY,
} from "../src/compaction/status.ts";
import { debugNotify, notify } from "../src/compaction/telemetry.ts";
import {
	cancelScheduledAutocompact,
	createScheduledAutocompact,
	scheduleAutocompact,
} from "../src/compaction/scheduler.ts";
import { registerCommands } from "../src/compaction/commands.ts";
import { handleBeforeCompact } from "../src/compaction/orchestration.ts";

export default function (pi: ExtensionAPI) {
	const state = createInitialState();
	let agentTurnIndex = 0;
	const scheduledAutocompact = createScheduledAutocompact();
	registerCommands(pi, state);

	pi.on("session_start", async (_event, ctx) => {
		const snapshot = await buildStatusSnapshot(ctx, state);
		applyStatus(ctx, snapshot);
		debugNotify(
			ctx,
			snapshot.config.debug,
			`loaded (${formatConfigSummary(snapshot.config)})`,
		);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		setStatusReportWidget(ctx);
		cancelScheduledAutocompact(scheduledAutocompact);
		noteCompactionCancelled(state);
	});

	pi.on("session_compact", async (event, ctx) => {
		const source = event.fromExtension ? "extension" : "core";
		const completedReason =
			event.fromExtension && state.lastCompactionReason
				? state.lastCompactionReason
				: event.reason;
		noteCompactionCompleted(
			state,
			state.lastTriggerTurn,
			source,
			completedReason,
		);
		const snapshot = await buildStatusSnapshot(ctx, state);
		applyStatus(ctx, snapshot);
		debugNotify(
			ctx,
			snapshot.config.debug,
			`compaction completed via ${source} (${event.reason})`,
		);
	});

	pi.on("agent_end", async (event, ctx) => {
		agentTurnIndex += 1;
		const usage = ctx.getContextUsage();
		if (!usage || usage.tokens === null) return;

		const configInfo = await loadEffectiveConfig(
			ctx.cwd,
			ctx.isProjectTrusted(),
		);
		const messages: unknown[] =
			isRecord(event) && Array.isArray(event.messages) ? event.messages : [];
		const toolResults = messages.filter(isToolResultLike);
		const evaluation = decideAutoCompact({
			config: configInfo.config,
			currentTokens: usage.tokens,
			previousTokens: state.previousTokens,
			contextWindow: usage.contextWindow,
			turnIndex: agentTurnIndex,
			consecutiveGrowthTurns: state.consecutiveGrowthTurns,
			compactInFlight: state.compactInFlight,
			lastTriggerTurn: state.lastTriggerTurn,
			toolResultTokens: estimateToolResultTokens(toolResults),
			toolResultsCount: toolResults.length,
		});

		noteEvaluation(state, evaluation);
		noteObservedTokens(state, usage.tokens);

		const snapshot: StatusSnapshot = {
			config: configInfo.config,
			configInfo,
			currentTokens: usage.tokens,
			contextWindow: usage.contextWindow,
			percent: usage.percent,
			state,
			evaluation,
		};
		applyStatus(ctx, snapshot);

		if (configInfo.warnings.length > 0) {
			debugNotify(
				ctx,
				configInfo.config.debug,
				configInfo.warnings.join(" | "),
			);
		}

		if (!evaluation.decision.compact) {
			debugNotify(
				ctx,
				configInfo.config.debug,
				`no compact (${evaluation.decision.reason}) after agent turn ${agentTurnIndex}`,
			);
			return;
		}

		noteCompactionRequested(state, agentTurnIndex, evaluation.decision.reason);
		notify(
			ctx,
			`Autocompact v2: ${evaluation.decision.reason} at ${usage.tokens.toLocaleString()} tokens after agent completion; compacting now.`,
			"info",
		);

		scheduleAutocompact(ctx, state, scheduledAutocompact, {
			turnIndex: agentTurnIndex,
			reason: evaluation.decision.reason,
			customInstructions: evaluation.decision.customInstructions,
		});
	});

	pi.on("session_before_compact", async (event, ctx) => {
		return handleBeforeCompact(event, ctx, state);
	});
}
