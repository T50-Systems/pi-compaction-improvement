import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	handleConfigCommand,
	setGlobalEnabled,
} from "../src/compaction/config-command-handlers.ts";
import { handleManualCompactCommand } from "../src/compaction/manual-compact-command.ts";
import { handleStatusCommand } from "../src/compaction/status-command-handlers.ts";
import { getLifecycleDiagnosticStorePath } from "../src/compaction/lifecycle-diagnostic-persistence.ts";
import { appendLifecycleDiagnostic } from "../src/compaction/lifecycle-diagnostics.ts";
import { createInitialState, type CompactionPhase } from "../src/state.ts";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), "pi-autocompact-commands-"));
	temporaryRoots.push(root);
	return root;
}

function makeContext(cwd: string, edited?: string) {
	return {
		compact: vi.fn(),
		cwd,
		getContextUsage: () => ({ tokens: 1_000, contextWindow: 10_000, percent: 10 }),
		hasUI: true,
		isProjectTrusted: () => true,
		ui: {
			editor: vi.fn(async () => edited),
			notify: vi.fn(),
			setStatus: vi.fn(),
			setWidget: vi.fn(),
		},
	};
}

afterEach(async () => {
	vi.unstubAllEnvs();
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("autocompact config command forms", () => {
	it("edits global and project configuration only in isolated fixtures", async () => {
		const root = await temporaryRoot();
		vi.stubEnv("HOME", root);
		vi.stubEnv("USERPROFILE", root);
		const ctx = makeContext(root, '{"enabled":false,"showStatus":true}');
		const state = createInitialState();

		await handleConfigCommand("", ctx, state);
		await handleConfigCommand("project", ctx, state);

		const globalText = await readFile(path.join(root, ".pi", "agent", "pi-autocompact-v2.json"), "utf8");
		const projectText = await readFile(path.join(root, ".pi", "pi-autocompact-v2.json"), "utf8");
		expect(JSON.parse(globalText)).toMatchObject({ enabled: false });
		expect(JSON.parse(projectText)).toMatchObject({ enabled: false });
		expect(ctx.ui.editor).toHaveBeenCalledTimes(2);
	});

	it("supports mutation, path, reset, on, and off forms", async () => {
		const root = await temporaryRoot();
		vi.stubEnv("HOME", root);
		vi.stubEnv("USERPROFILE", root);
		await mkdir(path.join(root, ".pi"), { recursive: true });
		const ctx = makeContext(root);
		const state = createInitialState();

		await handleConfigCommand("project showStatus false", ctx, state);
		expect(JSON.parse(await readFile(path.join(root, ".pi", "pi-autocompact-v2.json"), "utf8"))).toMatchObject({ showStatus: false });
		await handleConfigCommand("project path", ctx, state);
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("config path"), "info");
		await handleConfigCommand("project reset", ctx, state);
		await expect(readFile(path.join(root, ".pi", "pi-autocompact-v2.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });

		await setGlobalEnabled(ctx, state, false);
		await setGlobalEnabled(ctx, state, true);
		const globalConfig = JSON.parse(await readFile(path.join(root, ".pi", "agent", "pi-autocompact-v2.json"), "utf8"));
		expect(globalConfig.enabled).toBe(true);
	});

	it("returns actionable errors for malformed mutation forms", async () => {
		const root = await temporaryRoot();
		vi.stubEnv("HOME", root);
		vi.stubEnv("USERPROFILE", root);
		const ctx = makeContext(root);
		const state = createInitialState();

		await handleConfigCommand("project unknown true", ctx, state);
		await handleConfigCommand("project enabled maybe", ctx, state);
		await handleConfigCommand("project enabled", ctx, state);

		expect(ctx.ui.notify).toHaveBeenCalledWith("Unknown autocompact setting: unknown", "error");
		expect(ctx.ui.notify).toHaveBeenCalledWith("Invalid value for enabled: maybe", "error");
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Usage:"), "warning");
	});
});

describe("status and manual command handlers", () => {
	it.each<[CompactionPhase, boolean]>([
		["idle", false],
		["scheduled", true],
		["compacting", true],
		["failed", false],
		["completed", false],
	])("reports %s state", async (phase, inFlight) => {
		const root = await temporaryRoot();
		vi.stubEnv("HOME", root);
		vi.stubEnv("USERPROFILE", root);
		const ctx = makeContext(root);
		const state = createInitialState();
		state.compactionPhase = phase;
		state.compactInFlight = inFlight;

		await handleStatusCommand("", ctx, state);

		expect(ctx.ui.setWidget).toHaveBeenCalledWith(
			"pi-autocompact-v2-report",
			expect.arrayContaining([`compactionPhase: ${phase}`, `compactInFlight: ${inFlight}`]),
			{ placement: "belowEditor" },
		);
	});

	it("clears bounded lifecycle diagnostics and the widget deterministically", async () => {
		const root = await temporaryRoot();
		vi.stubEnv("HOME", root);
		vi.stubEnv("USERPROFILE", root);
		const storePath = getLifecycleDiagnosticStorePath();
		await mkdir(path.dirname(storePath), { recursive: true });
		await writeFile(storePath, "persisted", "utf8");
		const ctx = makeContext(root);
		const state = createInitialState();
		appendLifecycleDiagnostic(state.lifecycleDiagnostics, {
			triggerReason: "manual",
			terminalState: "completed",
			startedAt: 10,
			finishedAt: 20,
		});

		await handleStatusCommand("clear", ctx, state);

		expect(state.lifecycleDiagnostics).toEqual([]);
		await expect(readFile(storePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
		expect(ctx.ui.setWidget).toHaveBeenCalledWith("pi-autocompact-v2-report", undefined, { placement: "belowEditor" });
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("diagnostics"), "info");
	});

	it("requests manual compaction and handles success, failure, and in-flight rejection", async () => {
		const root = await temporaryRoot();
		const ctx = makeContext(root);
		const state = createInitialState();
		await handleManualCompactCommand("preserve decisions", ctx, state);
		const options = ctx.compact.mock.calls[0]?.[0];
		expect(options.customInstructions).toContain("preserve decisions");
		options.onComplete();
		expect(state.compactInFlight).toBe(false);

		await handleManualCompactCommand("", ctx, state);
		ctx.compact.mock.calls[1]?.[0].onError(new Error("provider failed"));
		expect(state.compactionPhase).toBe("failed");

		state.compactInFlight = true;
		await handleManualCompactCommand("", ctx, state);
		expect(ctx.compact).toHaveBeenCalledTimes(2);
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("already has"), "warning");
	});
});
