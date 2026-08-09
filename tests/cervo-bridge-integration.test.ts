import { access } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { preprocessWithCervoCompress } from "../src/compaction/cervo-preprocessor.ts";

const bridgePath = path.resolve(
	"bin",
	process.platform === "win32" ? "pi-cervo-compress.exe" : "pi-cervo-compress",
);
const bridgePresent = await access(bridgePath).then(
	() => true,
	() => false,
);

describe.skipIf(!bridgePresent)("packaged cervo-compress bridge", () => {
	it("compresses Pi tool results through the pinned Go library", async () => {
		const noisyOutput = `${Array.from({ length: 80 }, () => "progress").join("\r")}\nFAIL: TestCritical\n`;
		const result = await preprocessWithCervoCompress({
			messagesToSummarize: [
				{ role: "user", content: [{ type: "text", text: "keep request" }] },
				{
					role: "toolResult",
					toolCallId: "call-1",
					toolName: "shell",
					content: [{ type: "text", text: noisyOutput }],
					details: {},
					isError: true,
					timestamp: 1,
				},
			],
			turnPrefixMessages: [],
			firstKeptEntryId: "entry-1",
			tokensBefore: 1_000,
			previousSummary: undefined,
			fileOps: { read: new Set(), written: new Set(), edited: new Set() },
			settings: { reserveTokens: 2_048 },
		});

		expect(result).toMatchObject({ ok: true, changed: true });
		if (!result.ok) return;
		expect(result.report.savedBytes).toBeGreaterThan(0);
		expect(JSON.stringify(result.preparation.messagesToSummarize)).toContain(
			"FAIL: TestCritical",
		);
		expect(result.preparation.messagesToSummarize[1]).toMatchObject({
			role: "toolResult",
			toolCallId: "call-1",
		});
	});
});
