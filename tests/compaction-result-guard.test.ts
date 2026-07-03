import { describe, expect, it } from "vitest";
import { buildValidatedCompaction } from "../src/compaction/result-guard.ts";

describe("compaction result guard", () => {
	it("rejects empty summaries", () => {
		expect(
			buildValidatedCompaction({
				summary: "   ",
				firstKeptEntryId: "entry-1",
				tokensBefore: 100,
				details: { readFiles: [], modifiedFiles: [] },
			}),
		).toBeUndefined();
	});

	it("rejects invalid metadata", () => {
		expect(
			buildValidatedCompaction({
				summary: "ok",
				firstKeptEntryId: "",
				tokensBefore: 100,
				details: { readFiles: [], modifiedFiles: [] },
			}),
		).toBeUndefined();
		expect(
			buildValidatedCompaction({
				summary: "ok",
				firstKeptEntryId: "entry-1",
				tokensBefore: -1,
				details: { readFiles: [], modifiedFiles: [] },
			}),
		).toBeUndefined();
	});

	it("trims summary and filters file details", () => {
		const result = buildValidatedCompaction({
			summary: " summary ",
			firstKeptEntryId: "entry-1",
			tokensBefore: 100,
			details: {
				readFiles: ["a.ts", 123 as never],
				modifiedFiles: ["b.ts", null as never],
			},
		});

		expect(result).toEqual({
			compaction: {
				summary: "summary",
				firstKeptEntryId: "entry-1",
				tokensBefore: 100,
				details: { readFiles: ["a.ts"], modifiedFiles: ["b.ts"] },
			},
		});
	});
});
