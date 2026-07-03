import { describe, expect, it } from "vitest";
import {
	normalizeFileOperations,
	parseBeforeCompactEvent,
} from "../src/compaction/event-guard.ts";

describe("compaction event guard", () => {
	it("normalizes missing file operations to empty sets", () => {
		const fileOps = normalizeFileOperations(undefined);

		expect([...fileOps.read]).toEqual([]);
		expect([...fileOps.written]).toEqual([]);
		expect([...fileOps.edited]).toEqual([]);
	});

	it("filters non-string file operations", () => {
		const fileOps = normalizeFileOperations({
			read: new Set(["a.ts", 123, ""]),
			written: ["b.ts", false],
			edited: ["c.ts", null],
		});

		expect([...fileOps.read]).toEqual(["a.ts"]);
		expect([...fileOps.written]).toEqual(["b.ts"]);
		expect([...fileOps.edited]).toEqual(["c.ts"]);
	});

	it("returns undefined for invalid legacy event shapes", () => {
		expect(parseBeforeCompactEvent({ signal: undefined })).toBeUndefined();
		expect(
			parseBeforeCompactEvent({ preparation: { tokensBefore: 1 } }),
		).toBeUndefined();
	});

	it("accepts legacy events without signal", () => {
		const event = parseBeforeCompactEvent({
			customInstructions: "focus",
			preparation: {
				messagesToSummarize: [{ role: "user" }],
				turnPrefixMessages: [],
				firstKeptEntryId: "entry-1",
				tokensBefore: 1000,
				fileOps: { read: ["README.md"], written: [], edited: [] },
				settings: {},
			},
		});

		expect(event?.signal).toBeUndefined();
		expect(event?.customInstructions).toBe("focus");
		expect(event?.preparation.firstKeptEntryId).toBe("entry-1");
		expect([...(event?.preparation.fileOps.read ?? [])]).toEqual(["README.md"]);
		expect(event?.reason).toBe("threshold");
		expect(event?.willRetry).toBe(false);
	});

	it("preserves retry-oriented compaction metadata", () => {
		const event = parseBeforeCompactEvent({
			reason: "emergency-near-limit",
			willRetry: true,
			preparation: {
				messagesToSummarize: [{ role: "user" }],
				turnPrefixMessages: [],
				firstKeptEntryId: "entry-1",
				tokensBefore: 1000,
				settings: {},
			},
		});

		expect(event?.reason).toBe("overflow");
		expect(event?.willRetry).toBe(true);
	});
});
