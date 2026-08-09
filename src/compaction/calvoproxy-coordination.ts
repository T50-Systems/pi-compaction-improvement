export const CALVOPROXY_SESSION_HEADER = "X-Calvoproxy-Session-Id";
export const CALVOPROXY_COMPACTION_HEADER = "X-Calvoproxy-Compaction";

export type CalvoProxyCompactionCause =
	| "threshold"
	| "growth"
	| "tools"
	| "emergency"
	| "manual";

export interface CalvoProxyCompactionMetadata {
	sessionId: string;
	generation: number;
	cause: CalvoProxyCompactionCause;
	result: "structured" | "native";
	tool: "cervo" | "none";
}

export function shouldCoordinateWithCalvoProxy(model: {
	provider?: unknown;
	id?: unknown;
	name?: unknown;
	baseUrl?: unknown;
}): boolean {
	const explicit = process.env.PI_CALVOPROXY_COORDINATION?.trim().toLowerCase();
	if (explicit === "1" || explicit === "true" || explicit === "on") return true;
	return [model.provider, model.id, model.name, model.baseUrl].some(
		(value) =>
			typeof value === "string" && value.toLowerCase().includes("calvoproxy"),
	);
}

export function buildCalvoProxyCoordinationHeaders(
	metadata: CalvoProxyCompactionMetadata,
): Record<string, string> {
	if (!/^[0-9a-f]{32}$/i.test(metadata.sessionId)) {
		throw new Error(
			"CalvoProxy coordination session id must be a 128-bit hex value",
		);
	}
	if (!Number.isSafeInteger(metadata.generation) || metadata.generation < 0) {
		throw new Error(
			"CalvoProxy compaction generation must be a non-negative integer",
		);
	}
	return {
		[CALVOPROXY_SESSION_HEADER]: metadata.sessionId.toLowerCase(),
		[CALVOPROXY_COMPACTION_HEADER]: [
			"v1",
			`g=${metadata.generation}`,
			`cause=${metadata.cause}`,
			`result=${metadata.result}`,
			`tool=${metadata.tool}`,
		].join(";"),
	};
}

export function compactionCauseFor(
	trigger: string | null,
	fallback: "manual" | "overflow" | "threshold",
): CalvoProxyCompactionCause {
	switch (trigger) {
		case "manual-now":
			return "manual";
		case "rapid-growth":
		case "sustained-growth":
			return "growth";
		case "tool-heavy-turn":
			return "tools";
		case "emergency-near-limit":
			return "emergency";
		case "soft-threshold":
			return "threshold";
		default:
			return fallback === "overflow" ? "emergency" : fallback;
	}
}

export function mergeCoordinationHeaders(
	existing: Record<string, string | null> | undefined,
	metadata: CalvoProxyCompactionMetadata | undefined,
): Record<string, string | null> | undefined {
	if (!metadata) return existing;
	const coordination = buildCalvoProxyCoordinationHeaders(metadata);
	const merged = { ...existing };
	for (const [name, value] of Object.entries(coordination)) {
		for (const existingName of Object.keys(merged)) {
			if (existingName.toLowerCase() === name.toLowerCase()) {
				delete merged[existingName];
			}
		}
		merged[name] = value;
	}
	return merged;
}
