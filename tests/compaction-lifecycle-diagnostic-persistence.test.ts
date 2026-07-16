import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clearPersistedLifecycleDiagnostics,
	getLifecycleDiagnosticStorePath,
	LIFECYCLE_DIAGNOSTIC_STORE_VERSION,
	loadPersistedLifecycleDiagnostics,
	parseLifecycleDiagnosticEnvelope,
	persistLifecycleDiagnostics,
	serializeLifecycleDiagnosticEnvelope,
} from "../src/compaction/lifecycle-diagnostic-persistence.ts";
import {
	appendLifecycleDiagnostic,
	MAX_LIFECYCLE_DIAGNOSTICS,
	type CompactionLifecycleDiagnostic,
} from "../src/compaction/lifecycle-diagnostics.ts";

const temporaryRoots: string[] = [];

async function temporaryHome(): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), "pi-diagnostics-store-"));
	temporaryRoots.push(root);
	vi.stubEnv("HOME", root);
	vi.stubEnv("USERPROFILE", root);
	return root;
}

function entry(index = 0): CompactionLifecycleDiagnostic {
	return {
		timestamp: new Date(index * 1_000).toISOString(),
		triggerReason: "threshold",
		terminalState: "fallback",
		durationMs: index + 1,
		retryCount: 1,
		violatedInvariants: ["required-summary-sections-preserved"],
		fallbackCategory: "invalid-summary",
	};
}

afterEach(async () => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	await Promise.all(
		temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("lifecycle diagnostic persistence schema", () => {
	it("accepts only the versioned exact allowlist envelope", () => {
		const valid = { version: LIFECYCLE_DIAGNOSTIC_STORE_VERSION, entries: [entry()] };
		expect(parseLifecycleDiagnosticEnvelope(valid)).toEqual([entry()]);
		expect(parseLifecycleDiagnosticEnvelope({ ...valid, transcript: "private" })).toBeNull();
		expect(parseLifecycleDiagnosticEnvelope({ ...valid, version: 2 })).toBeNull();
		expect(parseLifecycleDiagnosticEnvelope({ ...valid, version: 0 })).toBeNull();
		expect(
			parseLifecycleDiagnosticEnvelope({
				...valid,
				entries: [{ ...entry(), prompt: "private" }],
			}),
		).toBeNull();
	});

	it("rejects invalid categories, values, duplicate invariants, and oversized history", () => {
		const envelope = (candidate: unknown) => ({ version: 1, entries: [candidate] });
		expect(parseLifecycleDiagnosticEnvelope(envelope({ ...entry(), triggerReason: "other" }))).toBeNull();
		expect(parseLifecycleDiagnosticEnvelope(envelope({ ...entry(), durationMs: -1 }))).toBeNull();
		expect(parseLifecycleDiagnosticEnvelope(envelope({ ...entry(), timestamp: "today" }))).toBeNull();
		expect(
			parseLifecycleDiagnosticEnvelope(
				envelope({
					...entry(),
					violatedInvariants: [
						"required-summary-sections-preserved",
						"required-summary-sections-preserved",
					],
				}),
			),
		).toBeNull();
		expect(
			parseLifecycleDiagnosticEnvelope({
				version: 1,
				entries: Array.from({ length: MAX_LIFECYCLE_DIAGNOSTICS + 1 }, (_, index) => entry(index)),
			}),
		).toBeNull();
	});

	it("serializes only the newest 20 categorical records with no free-text fields", () => {
		const history: CompactionLifecycleDiagnostic[] = [];
		for (let index = 0; index < MAX_LIFECYCLE_DIAGNOSTICS + 2; index += 1) {
			appendLifecycleDiagnostic(history, {
				triggerReason: "manual",
				terminalState: "completed",
				startedAt: index,
				finishedAt: index + 1,
			});
		}
		const serialized = serializeLifecycleDiagnosticEnvelope(history);
		const parsed = JSON.parse(serialized) as { entries: unknown[] };
		expect(parsed.entries).toHaveLength(MAX_LIFECYCLE_DIAGNOSTICS);
		expect(serialized).not.toMatch(/transcript|prompt|credential|apiKey|header|summaryText|errorMessage|project|path/i);
		const invalid = { ...entry(), triggerReason: "unknown", prompt: "private" } as unknown as CompactionLifecycleDiagnostic;
		expect(JSON.parse(serializeLifecycleDiagnosticEnvelope([invalid])).entries).toEqual([]);
	});
});

describe("best-effort local lifecycle diagnostic store", () => {
	it("writes atomically, hydrates, and durably clears the local-only file", async () => {
		await temporaryHome();
		const filePath = getLifecycleDiagnosticStorePath();
		await persistLifecycleDiagnostics([entry(1)]);
		expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({
			version: 1,
			entries: [entry(1)],
		});
		await expect(readFile(`${filePath}.tmp`, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
		expect(await loadPersistedLifecycleDiagnostics()).toEqual([entry(1)]);
		await persistLifecycleDiagnostics([entry(2)]);
		expect(await loadPersistedLifecycleDiagnostics()).toEqual([entry(2)]);
		await clearPersistedLifecycleDiagnostics();
		await expect(readFile(filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("treats corrupt, future, old, and oversized stores as empty", async () => {
		await temporaryHome();
		const filePath = getLifecycleDiagnosticStorePath();
		await mkdir(path.dirname(filePath), { recursive: true });
		for (const content of [
			"not json",
			JSON.stringify({ version: 2, entries: [entry()] }),
			JSON.stringify({ version: 0, entries: [entry()] }),
			"x".repeat(65 * 1024),
		]) {
			await writeFile(filePath, content, "utf8");
			expect(await loadPersistedLifecycleDiagnostics()).toEqual([]);
		}
	});

	it("contains read, write, and clear failures", async () => {
		const root = await temporaryHome();
		await writeFile(path.join(root, ".pi"), "blocks directory creation", "utf8");
		await expect(persistLifecycleDiagnostics([entry()])).resolves.toBeUndefined();
		await expect(loadPersistedLifecycleDiagnostics()).resolves.toEqual([]);
		await expect(clearPersistedLifecycleDiagnostics()).resolves.toBeUndefined();
	});
});
