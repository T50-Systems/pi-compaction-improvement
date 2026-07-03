import { describe, expect, it, vi } from "vitest";
import { complete } from "@earendil-works/pi-ai/compat";

vi.mock("@earendil-works/pi-ai/compat", () => ({
	complete: vi.fn(async () => ({
		content: [{ type: "text", text: " summary " }],
	})),
}));

import { requestSummary } from "../src/compaction/summary-provider.ts";

const model = { provider: "test", id: "model", maxTokens: 4096 } as never;
const auth = { apiKey: "key", headers: undefined, env: undefined };

describe("summary provider", () => {
	it("returns trimmed summary text", async () => {
		const result = await requestSummary({
			model,
			auth,
			promptText: "prompt",
			maxTokens: 100,
		});

		expect(result).toEqual({ ok: true, summary: "summary" });
		expect(complete).toHaveBeenCalledOnce();
	});

	it("maps empty provider text to empty result", async () => {
		vi.mocked(complete).mockResolvedValueOnce({
			content: [{ type: "text", text: "   " }],
		} as never);

		const result = await requestSummary({
			model,
			auth,
			promptText: "prompt",
			maxTokens: 100,
		});

		expect(result).toEqual({ ok: false, reason: "empty" });
	});

	it("maps provider errors to provider-error result", async () => {
		vi.mocked(complete).mockRejectedValueOnce(new Error("boom"));

		const result = await requestSummary({
			model,
			auth,
			promptText: "prompt",
			maxTokens: 100,
		});

		expect(result).toEqual({
			ok: false,
			reason: "provider-error",
			message: "boom",
		});
	});
});
