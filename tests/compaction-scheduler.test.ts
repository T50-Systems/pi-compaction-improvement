import { describe, expect, it, vi, afterEach } from "vitest";
import {
	createInitialState,
	noteCompactionCompleted,
	noteCompactionRequested,
} from "../src/state.ts";
import {
	cancelScheduledAutocompact,
	createScheduledAutocompact,
	scheduleAutocompact,
	AUTOCOMPACT_INITIAL_DEFER_MS,
} from "../src/compaction/scheduler.ts";

type MockSchedulerContext = ReturnType<typeof baseContext>;

function makeContext(
	overrides: Partial<MockSchedulerContext> = {},
): MockSchedulerContext {
	return { ...baseContext(), ...overrides };
}

function baseContext() {
	return {
		compact: vi.fn(),
		hasPendingMessages: vi.fn(() => false),
		hasUI: true,
		isIdle: vi.fn(() => true),
		ui: { notify: vi.fn() },
	};
}

afterEach(() => {
	vi.useRealTimers();
});

describe("compaction scheduler", () => {
	it("triggers compaction when scheduled request is still current", () => {
		vi.useFakeTimers();
		const state = createInitialState();
		noteCompactionRequested(state, 1, "soft-threshold");
		const schedule = createScheduledAutocompact();
		const ctx = makeContext();

		scheduleAutocompact(ctx as never, state, schedule, {
			turnIndex: 1,
			reason: "soft-threshold",
			customInstructions: "compact now",
		});
		vi.advanceTimersByTime(AUTOCOMPACT_INITIAL_DEFER_MS);

		expect(ctx.compact).toHaveBeenCalledWith(
			expect.objectContaining({ customInstructions: "compact now" }),
		);
	});

	it("ignores stale scheduled requests after cancellation", () => {
		vi.useFakeTimers();
		const state = createInitialState();
		noteCompactionRequested(state, 1, "soft-threshold");
		const schedule = createScheduledAutocompact();
		const ctx = makeContext();

		scheduleAutocompact(ctx as never, state, schedule, {
			turnIndex: 1,
			reason: "soft-threshold",
		});
		cancelScheduledAutocompact(schedule);
		vi.runOnlyPendingTimers();

		expect(ctx.compact).not.toHaveBeenCalled();
	});

	it("does not race core compaction during the initial defer window", () => {
		vi.useFakeTimers();
		const state = createInitialState();
		noteCompactionRequested(state, 1, "soft-threshold");
		const schedule = createScheduledAutocompact();
		const ctx = makeContext();

		scheduleAutocompact(ctx as never, state, schedule, {
			turnIndex: 1,
			reason: "soft-threshold",
		});
		noteCompactionCompleted(state, 1, "core", "threshold");
		vi.advanceTimersByTime(AUTOCOMPACT_INITIAL_DEFER_MS);

		expect(ctx.compact).not.toHaveBeenCalled();
	});

	it("fails safely when session never becomes idle", () => {
		vi.useFakeTimers();
		const state = createInitialState();
		noteCompactionRequested(state, 1, "soft-threshold");
		const schedule = createScheduledAutocompact();
		const ctx = makeContext({ isIdle: vi.fn(() => false) });

		scheduleAutocompact(ctx as never, state, schedule, {
			turnIndex: 1,
			reason: "soft-threshold",
		});
		vi.runAllTimers();

		expect(ctx.compact).not.toHaveBeenCalled();
		expect(state.compactInFlight).toBe(false);
		expect(state.compactionPhase).toBe("failed");
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			"Autocompact v2 skipped because the session never became idle after agent completion.",
			"warning",
		);
	});

	it("downgrades Pi signal races to a skipped compaction warning", () => {
		vi.useFakeTimers();
		const state = createInitialState();
		noteCompactionRequested(state, 1, "soft-threshold");
		const schedule = createScheduledAutocompact();
		const ctx = makeContext({
			compact: vi.fn((options) => {
				options.onError(
					new Error("Cannot read properties of undefined (reading 'signal')"),
				);
			}),
		});

		scheduleAutocompact(ctx as never, state, schedule, {
			turnIndex: 1,
			reason: "soft-threshold",
		});
		vi.advanceTimersByTime(AUTOCOMPACT_INITIAL_DEFER_MS);

		expect(state.compactionPhase).toBe("failed");
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			"Autocompact v2 skipped because another compaction was already in progress.",
			"warning",
		);
	});
});
