import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import extension from "../extensions/index.ts";
import { AUTOCOMPACT_DEFER_MS } from "../src/compaction/scheduler.ts";

type ExtensionHandler = (event: unknown, ctx: unknown) => Promise<void>;

function registerExtension(): Map<string, ExtensionHandler> {
	const handlers = new Map<string, ExtensionHandler>();
	const on = vi.fn((event: string, handler: ExtensionHandler) => {
		handlers.set(event, handler);
	});
	extension({ on, registerCommand: vi.fn() } as never);
	return handlers;
}

async function writeTriggerConfig(): Promise<string> {
	const cwd = path.join(tmpdir(), `pi-autocompact-test-${crypto.randomUUID()}`);
	await mkdir(path.join(cwd, ".pi"), { recursive: true });
	await writeFile(
		path.join(cwd, ".pi", "pi-autocompact-v2.json"),
		`${JSON.stringify({
			enabled: true,
			softBufferTokens: 30_000,
			emergencyBufferTokens: 10_000,
			minDeltaTokens: 0,
			minTurnsBetweenCompacts: 0,
			showStatus: true,
		})}\n`,
		"utf8",
	);
	return cwd;
}

function makeContext(cwd: string, compact = vi.fn()) {
	return {
		compact,
		cwd,
		getContextUsage: () => ({
			tokens: 120_000,
			contextWindow: 128_000,
			percent: 93.75,
		}),
		hasPendingMessages: vi.fn(() => false),
		hasUI: true,
		isIdle: vi.fn(() => true),
		isProjectTrusted: () => true,
		model: { provider: "test", id: "summarizer", maxTokens: 4096 },
		modelRegistry: {
			getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "key" })),
		},
		ui: {
			notify: vi.fn(),
			setStatus: vi.fn(),
			setWidget: vi.fn(),
		},
	};
}

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllTimers();
	vi.clearAllMocks();
});

describe("extension registration", () => {
	it("registers the proactive hooks and commands", () => {
		const on = vi.fn();
		const registerCommand = vi.fn();

		extension({ on, registerCommand } as never);

		expect(on).toHaveBeenCalledWith("input", expect.any(Function));
		expect(on).toHaveBeenCalledWith("agent_end", expect.any(Function));
		expect(on).toHaveBeenCalledWith(
			"session_before_compact",
			expect.any(Function),
		);
		expect(on).toHaveBeenCalledWith("session_compact", expect.any(Function));
		expect(registerCommand).toHaveBeenCalledWith(
			"autocompact-status",
			expect.any(Object),
		);
		expect(registerCommand).toHaveBeenCalledWith(
			"autocompact-now",
			expect.any(Object),
		);
		expect(registerCommand).toHaveBeenCalledWith(
			"autocompact-config",
			expect.any(Object),
		);
	});
});

describe("input autocompact guard", () => {
	it("compacts before replaying a prompt projected over the context threshold", async () => {
		const handlers = new Map<string, ExtensionHandler>();
		const sendUserMessage = vi.fn();
		const on = vi.fn((event: string, handler: ExtensionHandler) => {
			handlers.set(event, handler);
		});
		extension({ on, registerCommand: vi.fn(), sendUserMessage } as never);
		const compact = vi.fn((options?: { onComplete?: () => void }) => {
			options?.onComplete?.();
		});
		const ctx = makeContext(await writeTriggerConfig(), compact);

		const result = await handlers.get("input")?.(
			{ text: "continue", source: "interactive" },
			ctx,
		);

		expect(result).toEqual({ action: "handled" });
		expect(compact).toHaveBeenCalledWith(
			expect.objectContaining({ customInstructions: expect.any(String) }),
		);
		expect(sendUserMessage).toHaveBeenCalledWith("continue");
	});

	it("does not compact extension-replayed input again", async () => {
		const handlers = registerExtension();
		const ctx = makeContext(await writeTriggerConfig());

		const result = await handlers.get("input")?.(
			{ text: "continue", source: "extension" },
			ctx,
		);

		expect(result).toEqual({ action: "continue" });
		expect(ctx.compact).not.toHaveBeenCalled();
	});
});

describe("agent_end autocompact scheduling", () => {
	it("waits for the session to become idle with no pending messages before compacting", async () => {
		vi.useFakeTimers();
		const handlers = registerExtension();
		const ctx = makeContext(await writeTriggerConfig());
		ctx.isIdle.mockReturnValue(false);
		ctx.hasPendingMessages.mockReturnValue(true);

		await handlers.get("agent_end")?.({ messages: [] }, ctx);
		expect(ctx.compact).not.toHaveBeenCalled();

		await vi.runOnlyPendingTimersAsync();
		expect(ctx.compact).not.toHaveBeenCalled();

		ctx.isIdle.mockReturnValue(true);
		ctx.hasPendingMessages.mockReturnValue(false);
		await vi.advanceTimersByTimeAsync(AUTOCOMPACT_DEFER_MS);

		expect(ctx.compact).toHaveBeenCalledWith(
			expect.objectContaining({ customInstructions: expect.any(String) }),
		);
	});

	it("does not schedule duplicate compactions while one is deferred", async () => {
		vi.useFakeTimers();
		const handlers = registerExtension();
		const ctx = makeContext(await writeTriggerConfig());

		await handlers.get("agent_end")?.({ messages: [] }, ctx);
		await handlers.get("agent_end")?.({ messages: [] }, ctx);
		await vi.runOnlyPendingTimersAsync();

		expect(ctx.compact).toHaveBeenCalledTimes(1);
	});

	it("recovers compactInFlight when ctx.compact throws synchronously", async () => {
		vi.useFakeTimers();
		const handlers = registerExtension();
		const compact = vi
			.fn()
			.mockImplementationOnce(() => {
				throw new Error("boom");
			})
			.mockImplementationOnce(() => undefined);
		const ctx = makeContext(await writeTriggerConfig(), compact);

		await handlers.get("agent_end")?.({ messages: [] }, ctx);
		await vi.runOnlyPendingTimersAsync();

		expect(compact).toHaveBeenCalledTimes(1);
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("boom"),
			"error",
		);

		await handlers.get("agent_end")?.({ messages: [] }, ctx);
		await vi.runOnlyPendingTimersAsync();

		expect(compact).toHaveBeenCalledTimes(2);
	});

	it("cancels a deferred compaction on session shutdown", async () => {
		vi.useFakeTimers();
		const handlers = registerExtension();
		const ctx = makeContext(await writeTriggerConfig());

		await handlers.get("agent_end")?.({ messages: [] }, ctx);
		await handlers.get("session_shutdown")?.({}, ctx);
		await vi.runOnlyPendingTimersAsync();

		expect(ctx.compact).not.toHaveBeenCalled();
	});
});
