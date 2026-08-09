import { describe, expect, it } from "vitest";
import {
	preprocessWithCervoCompress,
	type CervoBridgeRunner,
} from "../src/compaction/cervo-preprocessor.ts";
import type { SafeCompactionPreparation } from "../src/compaction/types.ts";

function preparation(): SafeCompactionPreparation {
	return {
		messagesToSummarize: [
			{ role: "user", content: [{ type: "text", text: "keep request" }] },
			{
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "shell",
				content: [{ type: "text", text: "progress\nprogress\nFAIL: test" }],
				details: {},
				isError: false,
				timestamp: 1,
			},
		],
		turnPrefixMessages: [],
		firstKeptEntryId: "entry-1",
		tokensBefore: 1_000,
		previousSummary: undefined,
		fileOps: { read: new Set(), written: new Set(), edited: new Set() },
		settings: { reserveTokens: 2_048 },
	};
}

describe("cervo-compress preprocessing", () => {
	it("accepts an honest, shape-preserving deterministic bridge response", async () => {
		const runBridge: CervoBridgeRunner = async (request) => {
			const messages = structuredClone(request.messages) as Array<Record<string, unknown>>;
			const content = messages[1]?.content as Array<Record<string, unknown>>;
			const before = Buffer.byteLength(content[0]?.text as string);
			content[0] = { ...content[0], text: "progress\nFAIL: test" };
			const saved = before - Buffer.byteLength(content[0].text as string);
			return {
				version: 1,
				messages,
				report: {
					originalBytes: before,
					savedBytes: saved,
					engines: ["toolnoise"],
					byEngine: [{ Name: "toolnoise", SavedBytes: saved }],
				},
			};
		};

		const result = await preprocessWithCervoCompress(preparation(), { runBridge });

		expect(result).toMatchObject({ ok: true, changed: true });
		if (!result.ok) return;
		expect(result.preparation.messagesAreLlm).toBe(true);
		expect(result.preparation.messagesToSummarize).toHaveLength(2);
		expect(JSON.stringify(result.preparation.messagesToSummarize)).toContain("FAIL: test");
	});

	it("rejects dishonest byte accounting and structural mutation", async () => {
		const dishonest = await preprocessWithCervoCompress(preparation(), {
			runBridge: async (request) => ({
				version: 1,
				messages: request.messages,
				report: { originalBytes: 1, savedBytes: 1, engines: [], byEngine: [] },
			}),
		});
		expect(dishonest).toEqual({ ok: false, reason: "invalid-output" });

		const reshaped = await preprocessWithCervoCompress(preparation(), {
			runBridge: async (request) => ({
				version: 1,
				messages: (request.messages as Array<Record<string, unknown>>).map((message, index) =>
					index === 1 ? { ...message, role: "assistant" } : message,
				),
				report: { originalBytes: 48, savedBytes: 0, engines: [], byEngine: [] },
			}),
		});
		expect(reshaped).toEqual({ ok: false, reason: "invalid-output" });
	});

	it("classifies bridge availability and execution failures without carrying error text", async () => {
		const unavailable = await preprocessWithCervoCompress(preparation(), {
			runBridge: async () => {
				throw Object.assign(new Error("private machine path"), { code: "ENOENT" });
			},
		});
		expect(unavailable).toEqual({ ok: false, reason: "bridge-unavailable" });

		const failed = await preprocessWithCervoCompress(preparation(), {
			runBridge: async () => {
				throw new Error("private transcript fragment");
			},
		});
		expect(failed).toEqual({ ok: false, reason: "bridge-failed" });
		expect(JSON.stringify(failed)).not.toContain("private transcript fragment");
	});
});
