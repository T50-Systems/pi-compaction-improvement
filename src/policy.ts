import type { AutoCompactConfig } from "./config.ts";

export type AutoCompactDecisionReason =
  | "none"
  | "soft-threshold"
  | "rapid-growth"
  | "sustained-growth"
  | "emergency-near-limit"
  | "tool-heavy-turn"
  | "disabled"
  | "cooldown"
  | "in-flight";

export type AutoCompactDecisionMode = "standard" | "aggressive";

export interface PolicyInput {
  config: AutoCompactConfig;
  currentTokens: number;
  previousTokens: number | null;
  contextWindow: number;
  turnIndex: number;
  consecutiveGrowthTurns: number;
  compactInFlight: boolean;
  lastTriggerTurn: number | null;
  toolResultTokens: number;
  toolResultsCount: number;
}

export interface Thresholds {
  hardThreshold: number;
  softThreshold: number;
  emergencyThreshold: number;
  rapidGrowthFloor: number;
  sustainedGrowthFloor: number;
}

export interface CompactDecision {
  compact: boolean;
  reason: AutoCompactDecisionReason;
  mode?: AutoCompactDecisionMode;
  customInstructions?: string;
  bypassCooldown?: boolean;
}

export interface PolicyEvaluation {
  thresholds: Thresholds;
  deltaTokens: number;
  nextConsecutiveGrowthTurns: number;
  coolingDown: boolean;
  decision: CompactDecision;
}

export function computeThresholds(contextWindow: number, config: AutoCompactConfig): Thresholds {
  const hardThreshold = Math.max(0, contextWindow - config.reserveTokens);
  const softThreshold = Math.max(0, hardThreshold - config.softBufferTokens);
  const emergencyThreshold = Math.max(0, hardThreshold - config.emergencyBufferTokens);
  const rapidGrowthFloor = Math.floor((hardThreshold * config.rapidGrowthMinPercent) / 100);
  const sustainedGrowthFloor = Math.floor((hardThreshold * config.sustainedGrowthMinPercent) / 100);
  return { hardThreshold, softThreshold, emergencyThreshold, rapidGrowthFloor, sustainedGrowthFloor };
}

export function buildAutoCompactInstructions(reason: Exclude<AutoCompactDecisionReason, "none" | "disabled" | "cooldown" | "in-flight">, mode: AutoCompactDecisionMode): string {
  const directives = [`[AUTOCOMPACT_MODE=${mode}]`, `[AUTOCOMPACT_REASON=${reason}]`];
  const bodyByReason: Record<Exclude<AutoCompactDecisionReason, "none" | "disabled" | "cooldown" | "in-flight">, string> = {
    "soft-threshold": "Autocompact v2 triggered at the proactive soft threshold. Keep a balanced checkpoint that preserves the goal, constraints, concrete progress, blockers, exact files, the single immediate next action, and whether the agent should resume automatically after compaction.",
    "rapid-growth": "Autocompact v2 triggered because context grew quickly. Compress aggressively, minimize narration, and preserve only the facts required to continue safely, including the executable next action and whether to resume automatically.",
    "sustained-growth": "Autocompact v2 triggered after several consecutive growth turns. Emphasize the evolving state, unresolved blockers, and the best next step so future turns stay compact and can resume without waiting when unblocked.",
    "emergency-near-limit": "Autocompact v2 triggered in the emergency band near the hard context limit. Compress aggressively, keep exact errors and file paths, avoid redundant history, and preserve the action needed to resume after compaction.",
    "tool-heavy-turn": "Autocompact v2 triggered after a tool-heavy turn. Preserve the actionable conclusions from tool output, exact files touched, unresolved risks, the single next action, and whether the agent should continue without asking the user.",
  };
  return `${directives.join("\n")}\n\n${bodyByReason[reason]}`;
}

export function decideAutoCompact(input: PolicyInput): PolicyEvaluation {
  const thresholds = computeThresholds(input.contextWindow, input.config);
  const deltaTokens = input.previousTokens === null ? 0 : input.currentTokens - input.previousTokens;
  const growthTurn = deltaTokens >= input.config.minGrowthStepTokens;
  const nextConsecutiveGrowthTurns = growthTurn ? input.consecutiveGrowthTurns + 1 : 0;
  const turnsSinceLastTrigger = input.lastTriggerTurn === null ? Number.POSITIVE_INFINITY : input.turnIndex - input.lastTriggerTurn;
  const coolingDown = turnsSinceLastTrigger < input.config.minTurnsBetweenCompacts;

  if (!input.config.enabled) {
    return { thresholds, deltaTokens, nextConsecutiveGrowthTurns, coolingDown, decision: { compact: false, reason: "disabled" } };
  }

  if (input.compactInFlight) {
    return { thresholds, deltaTokens, nextConsecutiveGrowthTurns, coolingDown, decision: { compact: false, reason: "in-flight" } };
  }

  if (input.currentTokens >= thresholds.emergencyThreshold) {
    return {
      thresholds,
      deltaTokens,
      nextConsecutiveGrowthTurns,
      coolingDown,
      decision: {
        compact: true,
        reason: "emergency-near-limit",
        mode: "aggressive",
        customInstructions: buildAutoCompactInstructions("emergency-near-limit", "aggressive"),
        bypassCooldown: true,
      },
    };
  }

  if (coolingDown) {
    return { thresholds, deltaTokens, nextConsecutiveGrowthTurns, coolingDown, decision: { compact: false, reason: "cooldown" } };
  }

  if (
    input.toolResultsCount >= input.config.minToolResults &&
    input.toolResultTokens >= input.config.minToolResultTokens &&
    input.currentTokens >= thresholds.rapidGrowthFloor
  ) {
    return {
      thresholds,
      deltaTokens,
      nextConsecutiveGrowthTurns,
      coolingDown,
      decision: {
        compact: true,
        reason: "tool-heavy-turn",
        mode: "aggressive",
        customInstructions: buildAutoCompactInstructions("tool-heavy-turn", "aggressive"),
      },
    };
  }

  if (deltaTokens >= input.config.minDeltaTokens && input.currentTokens >= thresholds.rapidGrowthFloor) {
    return {
      thresholds,
      deltaTokens,
      nextConsecutiveGrowthTurns,
      coolingDown,
      decision: {
        compact: true,
        reason: "rapid-growth",
        mode: "aggressive",
        customInstructions: buildAutoCompactInstructions("rapid-growth", "aggressive"),
      },
    };
  }

  if (
    nextConsecutiveGrowthTurns >= input.config.sustainedGrowthTurns &&
    input.currentTokens >= thresholds.sustainedGrowthFloor
  ) {
    return {
      thresholds,
      deltaTokens,
      nextConsecutiveGrowthTurns,
      coolingDown,
      decision: {
        compact: true,
        reason: "sustained-growth",
        mode: "standard",
        customInstructions: buildAutoCompactInstructions("sustained-growth", "standard"),
      },
    };
  }

  if (input.currentTokens >= thresholds.softThreshold) {
    return {
      thresholds,
      deltaTokens,
      nextConsecutiveGrowthTurns,
      coolingDown,
      decision: {
        compact: true,
        reason: "soft-threshold",
        mode: "standard",
        customInstructions: buildAutoCompactInstructions("soft-threshold", "standard"),
      },
    };
  }

  return { thresholds, deltaTokens, nextConsecutiveGrowthTurns, coolingDown, decision: { compact: false, reason: "none" } };
}
