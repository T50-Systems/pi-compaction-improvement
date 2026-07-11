import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { complete } from "@earendil-works/pi-ai/compat";

vi.mock("@earendil-works/pi-ai/compat", () => ({
	complete: vi.fn(async () => ({
		content: [{ type: "text", text: "summary" }],
	})),
}));
import extension from "../extensions/index.ts";

type ExtensionHandler = (event: unknown, ctx: unknown) => Promise<unknown>;

function structuredSummary(body = "useful summary"): string {
	return [
		"## Goal",
		body,
		"",
		"## Constraints & Preferences",
		"- Keep working safely.",
		"",
		"## Progress",
		"### Done",
		"- [x] Summarized prior context.",
		"",
		"### In Progress",
		"- [ ] Continue implementation.",
		"",
		"### Blocked",
		"- None.",
		"",
		"## Key Decisions",
		"- Preserve exact paths.",
		"",
		"## Discarded Hypotheses",
		"- None.",
		"",
		"## Risks",
		"- None.",
		"",
		"## Immediate Next Action",
		"1. Continue with the next validation step.",
		"",
		"## Continuation Contract",
		"- Resume automatically after compaction: yes",
		"- If no, ask the user exactly this: N/A",
		"",
		"## Next Steps",
		"1. Validate the implementation.",
		"",
		"## Critical Context",
		"- tests/extension-before-compact.test.ts",
	].join("\n");
}

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

function makeContext(cwd: string) {
	return {
		compact: vi.fn(),
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

function makeBeforeCompactEvent(overrides: Record<string, unknown> = {}) {
	const { preparation, ...rest } = overrides;
	return {
		type: "session_before_compact",
		customInstructions: "focus",
		reason: "threshold",
		willRetry: false,
		preparation: {
			messagesToSummarize: [
				{ role: "user", content: [{ type: "text", text: "hello" }] },
			],
			turnPrefixMessages: [],
			firstKeptEntryId: "entry-1",
			tokensBefore: 1000,
			previousSummary: undefined,
			fileOps: { read: new Set(), written: new Set(), edited: new Set() },
			settings: { reserveTokens: 2048 },
			...(preparation as Record<string, unknown> | undefined),
		},
		...rest,
	};
}

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllTimers();
	vi.clearAllMocks();
});

describe("session_before_compact summarization", () => {
	it("handles provider failure when older runtimes omit the compaction signal", async () => {
		const handlers = registerExtension();
		const ctx = makeContext(await writeTriggerConfig());
		vi.mocked(complete).mockRejectedValueOnce(new Error("provider down"));

		await expect(
			handlers.get("session_before_compact")?.(makeBeforeCompactEvent(), ctx),
		).resolves.toBeUndefined();

		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("provider down"),
			"error",
		);
	});

	it("falls back safely when the compaction event shape is invalid", async () => {
		const handlers = registerExtension();
		const ctx = makeContext(await writeTriggerConfig());

		await expect(
			handlers.get("session_before_compact")?.(undefined, ctx),
		).resolves.toBeUndefined();

		expect(complete).not.toHaveBeenCalled();
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("incompatible compaction event"),
			"warning",
		);
	});

	it("returns a validated custom compaction for a valid summary", async () => {
		const handlers = registerExtension();
		const ctx = makeContext(await writeTriggerConfig());
		vi.mocked(complete).mockResolvedValueOnce({
			content: [{ type: "text", text: structuredSummary("useful summary") }],
		} as never);

		const result = await handlers.get("session_before_compact")?.(
			makeBeforeCompactEvent(),
			ctx,
		);

		expect(result).toEqual({
			compaction: {
				summary: expect.stringContaining("useful summary"),
				firstKeptEntryId: "entry-1",
				tokensBefore: 1000,
				details: { readFiles: [], modifiedFiles: [] },
			},
		});
	});

	it("falls back when the validated compaction result would be incomplete", async () => {
		const handlers = registerExtension();
		const ctx = makeContext(await writeTriggerConfig());
		vi.mocked(complete).mockResolvedValueOnce({
			content: [{ type: "text", text: structuredSummary() }],
		} as never);

		const result = await handlers.get("session_before_compact")?.(
			makeBeforeCompactEvent({
				preparation: { firstKeptEntryId: undefined },
			}),
			ctx,
		);

		expect(result).toBeUndefined();
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("invalid summary result"),
			"warning",
		);
	});

	it("normalizes file operation arrays before appending file tags", async () => {
		const handlers = registerExtension();
		const ctx = makeContext(await writeTriggerConfig());
		vi.mocked(complete).mockResolvedValueOnce({
			content: [{ type: "text", text: structuredSummary() }],
		} as never);

		const result = await handlers.get("session_before_compact")?.(
			makeBeforeCompactEvent({
				preparation: {
					fileOps: {
						read: ["read-a.ts", "changed.ts", 42],
						written: ["changed.ts"],
						edited: ["edited.ts"],
					},
				},
			}),
			ctx,
		);

		expect(result).toEqual({
			compaction: expect.objectContaining({
				details: {
					readFiles: ["read-a.ts"],
					modifiedFiles: ["changed.ts", "edited.ts"],
				},
			}),
		});
	});

	it("retries once with aggressive mode when the summary structure is invalid", async () => {
		const handlers = registerExtension();
		const ctx = makeContext(await writeTriggerConfig());
		vi.mocked(complete)
			.mockResolvedValueOnce({
				content: [{ type: "text", text: "loose prose summary" }],
			} as never)
			.mockResolvedValueOnce({
				content: [{ type: "text", text: structuredSummary("retry summary") }],
			} as never);

		const result = await handlers.get("session_before_compact")?.(
			makeBeforeCompactEvent(),
			ctx,
		);

		expect(
			(result as { compaction?: { summary?: string } } | undefined)?.compaction
				?.summary,
		).toContain("retry summary");
		expect(complete).toHaveBeenCalledTimes(2);
		expect(vi.mocked(complete).mock.calls[1]?.[1]).toEqual(
			expect.objectContaining({
				messages: expect.arrayContaining([
					expect.objectContaining({
						content: expect.arrayContaining([
							expect.objectContaining({
								text: expect.stringContaining("mode=aggressive"),
							}),
						]),
					}),
				]),
			}),
		);
	});

	it("adds a dedicated split-turn context summary for turn prefix messages", async () => {
		const handlers = registerExtension();
		const ctx = makeContext(await writeTriggerConfig());
		vi.mocked(complete)
			.mockResolvedValueOnce({
				content: [{ type: "text", text: structuredSummary("history summary") }],
			} as never)
			.mockResolvedValueOnce({
				content: [{ type: "text", text: "prefix context summary" }],
			} as never);

		const result = await handlers.get("session_before_compact")?.(
			makeBeforeCompactEvent({
				preparation: {
					turnPrefixMessages: [
						{
							role: "assistant",
							content: [{ type: "text", text: "early work" }],
						},
					],
				},
			}),
			ctx,
		);

		const summary = (
			result as { compaction?: { summary?: string } } | undefined
		)?.compaction?.summary;
		expect(summary).toContain("history summary");
		expect(summary).toContain("**Turn Context (split turn):**");
		expect(summary).toContain("prefix context summary");
		expect(complete).toHaveBeenCalledTimes(2);
		expect(vi.mocked(complete).mock.calls[0]?.[1]).toEqual(
			expect.objectContaining({
				messages: expect.arrayContaining([
					expect.objectContaining({
						content: expect.arrayContaining([
							expect.objectContaining({
								text: expect.not.stringContaining("<turn-prefix-messages>"),
							}),
						]),
					}),
				]),
			}),
		);
		expect(vi.mocked(complete).mock.calls[1]?.[1]).toEqual(
			expect.objectContaining({
				messages: expect.arrayContaining([
					expect.objectContaining({
						content: expect.arrayContaining([
							expect.objectContaining({
								text: expect.stringContaining("<turn-prefix-messages>"),
							}),
						]),
					}),
				]),
			}),
		);
	});

	it("filters noisy todo and command output before the provider sees the prompt", async () => {
		const handlers = registerExtension();
		const ctx = makeContext(await writeTriggerConfig());
		vi.mocked(complete).mockResolvedValueOnce({
			content: [{ type: "text", text: structuredSummary("filtered summary") }],
		} as never);
		const noisyHistory = [
			...Array.from(
				{ length: 50 },
				(_, index) => `${100 - index} internal/example/file-${index}.go`,
			),
			"",
			"● Todos (85/87)",
			...Array.from(
				{ length: 85 },
				(_, index) => `├─ ✓ #${index + 1} Completed task ${index + 1}`,
			),
			"├─ □ #86 Inspect Shaper state",
			"└─ ⟳ #87 Update goal progress after get_goal",
			"",
			"Model stopped because it reached the maximum output token limit.",
		].join("\n");

		const result = await handlers.get("session_before_compact")?.(
			makeBeforeCompactEvent({
				preparation: {
					messagesToSummarize: [
						{
							role: "assistant",
							content: [{ type: "text", text: noisyHistory }],
						},
					],
					tokensBefore: 120_000,
				},
			}),
			ctx,
		);

		expect(result).toEqual({
			compaction: expect.objectContaining({
				summary: expect.stringContaining("filtered summary"),
			}),
		});
		const promptText = (vi.mocked(complete).mock.calls[0]?.[1] as {
			messages?: Array<{ content?: Array<{ text?: string }> }>;
		}).messages?.[0]?.content?.[0]?.text;
		expect(promptText).toContain("condensed 87-row todo snapshot");
		expect(promptText).toContain("omitted 85 completed rows");
		expect(promptText).toContain("Inspect Shaper state");
		expect(promptText).toContain("Update goal progress after get_goal");
		expect(promptText).toContain("omitted 42 count/path output lines");
		expect(promptText).toContain(
			"Model stopped because it reached the maximum output token limit.",
		);
		expect(promptText).not.toContain("Completed task 1");
		expect(promptText).not.toContain("Completed task 85");
		expect(promptText).not.toContain("internal/example/file-20.go");
	});

	it("times out a hanging summary request and falls back to default compaction", async () => {
		vi.useFakeTimers();
		const handlers = registerExtension();
		const ctx = makeContext(await writeTriggerConfig());
		vi.mocked(complete).mockImplementationOnce(
			(
				_model: unknown,
				_request: unknown,
				options?: { signal?: AbortSignal },
			) =>
				new Promise((_, reject) => {
					options?.signal?.addEventListener("abort", () => {
						reject(new Error("aborted"));
					});
				}) as never,
		);

		const resultPromise = handlers.get("session_before_compact")?.(
			makeBeforeCompactEvent(),
			ctx,
		);
		await vi.advanceTimersByTimeAsync(120_000);

		await expect(resultPromise).resolves.toBeUndefined();
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("timed out"),
			"warning",
		);
	});
});
