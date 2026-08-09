import { describe, expect, it, vi } from "vitest";
import {
	buildCalvoProxyCoordinationHeaders,
	compactionCauseFor,
	mergeCoordinationHeaders,
	shouldCoordinateWithCalvoProxy,
} from "../src/compaction/calvoproxy-coordination.ts";

const metadata = {
	sessionId: "0123456789abcdef0123456789abcdef",
	generation: 3,
	cause: "tools" as const,
	result: "structured" as const,
	tool: "cervo" as const,
};

describe("CalvoProxy coordination metadata", () => {
	it("renders the agreed content-free v1 request headers", () => {
		expect(buildCalvoProxyCoordinationHeaders(metadata)).toEqual({
			"X-Calvoproxy-Session-Id": metadata.sessionId,
			"X-Calvoproxy-Compaction":
				"v1;g=3;cause=tools;result=structured;tool=cervo",
		});
	});

	it("overrides stale coordination values case-insensitively without mutating auth headers", () => {
		const existing = {
			Authorization: "Bearer private",
			"x-calvoproxy-session-id": "stale",
		};
		const merged = mergeCoordinationHeaders(existing, metadata);
		expect(merged).toMatchObject({
			Authorization: "Bearer private",
			"X-Calvoproxy-Session-Id": metadata.sessionId,
		});
		expect(merged).not.toHaveProperty("x-calvoproxy-session-id");
		expect(existing["x-calvoproxy-session-id"]).toBe("stale");
	});

	it("maps Pi trigger vocabulary to the closed contract causes", () => {
		expect(compactionCauseFor("rapid-growth", "threshold")).toBe("growth");
		expect(compactionCauseFor("tool-heavy-turn", "threshold")).toBe("tools");
		expect(compactionCauseFor("emergency-near-limit", "threshold")).toBe("emergency");
		expect(compactionCauseFor("manual-now", "threshold")).toBe("manual");
		expect(compactionCauseFor(null, "threshold")).toBe("threshold");
	});

	it("rejects identifiers and generations outside the contract", () => {
		expect(() =>
			buildCalvoProxyCoordinationHeaders({ ...metadata, sessionId: "user@example.com" }),
		).toThrow(/128-bit/);
		expect(() =>
			buildCalvoProxyCoordinationHeaders({ ...metadata, generation: -1 }),
		).toThrow(/non-negative/);
	});

	it("limits coordination to CalvoProxy targets or explicit opt-in", () => {
		vi.stubEnv("PI_CALVOPROXY_COORDINATION", "");
		expect(shouldCoordinateWithCalvoProxy({ provider: "calvoproxy" })).toBe(true);
		expect(
			shouldCoordinateWithCalvoProxy({ baseUrl: "https://api.openai.com/v1" }),
		).toBe(false);
		vi.stubEnv("PI_CALVOPROXY_COORDINATION", "1");
		expect(shouldCoordinateWithCalvoProxy({ provider: "custom" })).toBe(true);
		vi.unstubAllEnvs();
	});
});
