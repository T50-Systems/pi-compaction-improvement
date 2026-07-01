import type { AutoCompactConfig, ConfigLoadResult } from "./config.ts";
import type { AutoCompactDecisionReason, PolicyEvaluation } from "./policy.ts";

export interface AutoCompactState {
  previousTokens: number | null;
  lastTriggerTurn: number | null;
  lastSuccessfulCompactTurn: number | null;
  compactInFlight: boolean;
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
    consecutiveGrowthTurns: 0,
    lastDecisionReason: "none",
    lastCompactionReason: null,
    lastCompactionSource: null,
    compactionCount: 0,
  };
}

export function noteEvaluation(state: AutoCompactState, evaluation: PolicyEvaluation): void {
  state.consecutiveGrowthTurns = evaluation.nextConsecutiveGrowthTurns;
  state.lastDecisionReason = evaluation.decision.reason;
}

export function noteObservedTokens(state: AutoCompactState, currentTokens: number): void {
  state.previousTokens = currentTokens;
}

export function noteCompactionRequested(state: AutoCompactState, turnIndex: number, reason: string): void {
  state.compactInFlight = true;
  state.lastTriggerTurn = turnIndex;
  state.lastCompactionReason = reason;
}

export function noteCompactionCompleted(state: AutoCompactState, turnIndex: number | null, source: "extension" | "core", reason: string): void {
  state.compactInFlight = false;
  state.previousTokens = null;
  state.consecutiveGrowthTurns = 0;
  state.lastSuccessfulCompactTurn = turnIndex;
  state.lastCompactionReason = reason;
  state.lastCompactionSource = source;
  state.compactionCount += 1;
}

export function noteCompactionFailed(state: AutoCompactState): void {
  state.compactInFlight = false;
}

function formatTokens(value: number | null): string {
  return value === null ? "?" : value.toLocaleString();
}

function formatPercent(value: number | null): string {
  return value === null ? "?" : `${value.toFixed(1)}%`;
}

export function formatStatusLine(snapshot: StatusSnapshot): string {
  const activeOverride = snapshot.configInfo.activeProjectOverride ? " project" : "";
  const thresholds = snapshot.evaluation?.thresholds;
  const soft = thresholds ? thresholds.softThreshold.toLocaleString() : "?";
  return [
    `ACv2 ${snapshot.config.enabled ? "on" : "off"}${activeOverride}`,
    `${formatTokens(snapshot.currentTokens)}/${formatTokens(snapshot.contextWindow)} (${formatPercent(snapshot.percent)})`,
    `soft ${soft}`,
    `streak ${snapshot.state.consecutiveGrowthTurns}`,
    `last ${snapshot.state.lastCompactionReason ?? snapshot.state.lastDecisionReason}`,
  ].join(" | ");
}

export function formatStatusReport(snapshot: StatusSnapshot): string {
  const thresholds = snapshot.evaluation?.thresholds;
  return [
    "pi-autocompact-v2 status",
    `enabled: ${snapshot.config.enabled}`,
    `usage: ${formatTokens(snapshot.currentTokens)} / ${formatTokens(snapshot.contextWindow)} (${formatPercent(snapshot.percent)})`,
    `thresholds: hard=${thresholds ? thresholds.hardThreshold.toLocaleString() : "?"}, soft=${thresholds ? thresholds.softThreshold.toLocaleString() : "?"}, emergency=${thresholds ? thresholds.emergencyThreshold.toLocaleString() : "?"}`,
    `deltaTokens: ${snapshot.evaluation ? snapshot.evaluation.deltaTokens.toLocaleString() : "?"}`,
    `growthStreak: ${snapshot.state.consecutiveGrowthTurns}`,
    `compactInFlight: ${snapshot.state.compactInFlight}`,
    `lastDecision: ${snapshot.state.lastDecisionReason}`,
    `lastCompaction: ${snapshot.state.lastCompactionReason ?? "none"} (${snapshot.state.lastCompactionSource ?? "n/a"})`,
    `compactionCount: ${snapshot.state.compactionCount}`,
    `config: ${snapshot.configInfo.globalPath}${snapshot.configInfo.activeProjectOverride ? ` + ${snapshot.configInfo.projectPath}` : ""}`,
    snapshot.configInfo.warnings.length > 0 ? `warnings: ${snapshot.configInfo.warnings.join(" | ")}` : "warnings: none",
  ].join("\n");
}
