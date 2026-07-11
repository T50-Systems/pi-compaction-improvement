import { afterEach, describe, expect, it, vi } from "vitest";
import { complete } from "@earendil-works/pi-ai/compat";

vi.mock("@earendil-works/pi-ai/compat", () => ({
	complete: vi.fn(),
}));

import {
	appendLifecycleDiagnostic,
	MAX_LIFECYCLE_DIAGNOSTICS,
} from "../src/compaction/lifecycle-diagnostics.ts";
import { handleBeforeCompact } from "../src/compaction/orchestration.ts";
import { createInitialState } from "../src/state.ts";

const STRUCTURED_SUMMARY = `## Goal
Continue safely.

## Progress
### Done
- [x] Preserved context.
### In Progress
- [ ] Continue.
### Blocked
- None.

## Immediate Next Action
1. Continue.

## Continuation Contract
- Resume automatically after compaction: yes
- If no, ask the user exactly this: N/A

## Critical Context
- No private content retained.`;

function event(signal?: AbortSignal) {
	return {
		type: "session_before_compact",
		reason: "threshold",
		willRetry: false,
		signal,
		preparation: {
			messagesToSummarize: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
			turnPrefixMessages: [],
			firstKeptEntryId: "entry-1",
			tokensBefore: 1_000,
			previousSummary: undefined,
			fileOps: { read: new Set(), written: new Set(), edited: new Set() },
			settings: { reserveTokens: 2_048 },
		},
	};
}

function context(overrides: Record<string, unknown> = {}) {
	return {
		hasUI: true,
		model: { provider: "fixture", id: "summary", maxTokens: 4_096 },
		modelRegistry: {
			getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "test-only" })),
		},
		ui: { notify: vi.fn() },
		...overrides,
	};
}

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe("privacy-safe lifecycle diagnostic history", () => {
	it("keeps only the newest bounded entries in a closed schema", () => {
		const state = createInitialState();
		for (let index = 0; index < MAX_LIFECYCLE_DIAGNOSTICS + 3; index += 1) {
			appendLifecycleDiagnostic(state.lifecycleDiagnostics, {
				triggerReason: "manual",
				terminalState: "fallback",
				startedAt: index,
				finishedAt: index + 2,
				retryCount: 1,
				fallbackCategory: "invalid-summary",
				violatedInvariants: ["required-summary-sections-preserved"],
			});
		}

		expect(state.lifecycleDiagnostics).toHaveLength(MAX_LIFECYCLE_DIAGNOSTICS);
		expect(Object.keys(state.lifecycleDiagnostics[0] ?? {}).sort()).toEqual([
			"durationMs",
			"fallbackCategory",
			"retryCount",
			"terminalState",
			"timestamp",
			"triggerReason",
			"violatedInvariants",
		].sort());
		expect(JSON.stringify(state.lifecycleDiagnostics)).not.toMatch(/prompt|summaryText|apiKey|header|credential|fileContent/i);
	});

	it("records normal completion and aggressive retry", async () => {
		const state = createInitialState();
		vi.mocked(complete)
			.mockResolvedValueOnce({ content: [{ type: "text", text: "invalid" }] } as never)
			.mockResolvedValueOnce({ content: [{ type: "text", text: STRUCTURED_SUMMARY }] } as never);

		await handleBeforeCompact(event(), context() as never, state);

		expect(state.lifecycleDiagnostics.at(-1)).toMatchObject({
			triggerReason: "threshold",
			terminalState: "completed",
			retryCount: 1,
			violatedInvariants: [],
		});
	});

	it("records invariant failure without retaining rejected output", async () => {
		const state = createInitialState();
		vi.mocked(complete).mockResolvedValue({ content: [{ type: "text", text: "private rejected prose" }] } as never);

		await handleBeforeCompact(event(), context() as never, state);

		const diagnostic = state.lifecycleDiagnostics.at(-1);
		expect(diagnostic).toMatchObject({
			terminalState: "fallback",
			retryCount: 1,
			fallbackCategory: "invalid-summary",
			violatedInvariants: ["required-summary-sections-preserved"],
		});
		expect(JSON.stringify(diagnostic)).not.toContain("private rejected prose");
	});

	it("records deterministic provider timeout and caller abort fallbacks", async () => {
		vi.useFakeTimers();
		const timeoutState = createInitialState();
		vi.mocked(complete).mockImplementation((_model, _request, options) => {
			if (options?.signal?.aborted) return Promise.reject(new Error("aborted")) as never;
			return new Promise((_, reject) =>
				options?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
			) as never;
		});
		const timeout = handleBeforeCompact(event(), context() as never, timeoutState);
		await vi.advanceTimersByTimeAsync(120_000);
		await timeout;
		expect(timeoutState.lifecycleDiagnostics.at(-1)).toMatchObject({
			terminalState: "fallback",
			fallbackCategory: "timeout",
		});

		const abortState = createInitialState();
		const controller = new AbortController();
		controller.abort();
		await handleBeforeCompact(event(controller.signal), context() as never, abortState);
		expect(abortState.lifecycleDiagnostics.at(-1)).toMatchObject({
			terminalState: "fallback",
			fallbackCategory: "aborted",
		});
	});

	it("records missing model and auth as distinct skipped fallbacks", async () => {
		const modelState = createInitialState();
		await handleBeforeCompact(event(), context({ model: undefined }) as never, modelState);
		expect(modelState.lifecycleDiagnostics.at(-1)).toMatchObject({ terminalState: "skipped", fallbackCategory: "missing-model" });

		const authState = createInitialState();
		await handleBeforeCompact(
			event(),
			context({ modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: false }) } }) as never,
			authState,
		);
		expect(authState.lifecycleDiagnostics.at(-1)).toMatchObject({ terminalState: "skipped", fallbackCategory: "missing-auth" });
	});
});
