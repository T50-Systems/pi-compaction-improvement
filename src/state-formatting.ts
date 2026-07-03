import type { StatusSnapshot } from "./state.ts";

function formatTokens(value: number | null): string {
	return value === null ? "?" : value.toLocaleString();
}

function formatPercent(value: number | null): string {
	return value === null ? "?" : `${value.toFixed(1)}%`;
}

export function formatStatusLine(snapshot: StatusSnapshot): string {
	const activeOverride = snapshot.configInfo.activeProjectOverride
		? " project"
		: "";
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
		`compactionPhase: ${snapshot.state.compactionPhase}`,
		`lastDecision: ${snapshot.state.lastDecisionReason}`,
		`lastCompaction: ${snapshot.state.lastCompactionReason ?? "none"} (${snapshot.state.lastCompactionSource ?? "n/a"})`,
		`compactionCount: ${snapshot.state.compactionCount}`,
		`config: ${snapshot.configInfo.globalPath}${snapshot.configInfo.activeProjectOverride ? ` + ${snapshot.configInfo.projectPath}` : ""}`,
		snapshot.configInfo.warnings.length > 0
			? `warnings: ${snapshot.configInfo.warnings.join(" | ")}`
			: "warnings: none",
	].join("\n");
}
