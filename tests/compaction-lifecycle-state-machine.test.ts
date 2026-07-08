import { describe, expect, it } from "vitest";
import {
	COMPACTION_LIFECYCLE_ALPHABET,
	COMPACTION_LIFECYCLE_INITIAL_STATE,
	COMPACTION_LIFECYCLE_STATES,
	COMPACTION_LIFECYCLE_TERMINAL_STATES,
	createCompactionLifecycleSnapshot,
	failCompactionLifecycle,
	skipCompactionLifecycle,
	transitionCompactionLifecycle,
} from "../src/compaction/lifecycle-state-machine.ts";

describe("compaction lifecycle state machine", () => {
	it("declares the formal automaton components", () => {
		expect(COMPACTION_LIFECYCLE_INITIAL_STATE).toBe("idle");
		expect(COMPACTION_LIFECYCLE_STATES).toContain(
			COMPACTION_LIFECYCLE_INITIAL_STATE,
		);
		expect(COMPACTION_LIFECYCLE_TERMINAL_STATES).toEqual([
			"completed",
			"skipped",
			"failed",
		]);
		expect(COMPACTION_LIFECYCLE_ALPHABET).toContain("event-observed");
		expect(COMPACTION_LIFECYCLE_ALPHABET).toContain("completed");
	});

	it("allows the happy-path lifecycle only in order", () => {
		let lifecycle = createCompactionLifecycleSnapshot();
		for (const type of [
			"event-observed",
			"auth-resolved",
			"plan-built",
			"mode-resolved",
			"history-requested",
			"history-produced",
			"history-validated",
			"turn-prefix-requested",
			"turn-prefix-produced",
			"summary-assembled",
			"verification-started",
			"commit-accepted",
			"completed",
		] as const) {
			lifecycle = transitionCompactionLifecycle(lifecycle, { type, at: 1 });
		}

		expect(lifecycle.status).toBe("completed");
		expect(lifecycle.history.map((event) => event.type)).toEqual([
			"event-observed",
			"auth-resolved",
			"plan-built",
			"mode-resolved",
			"history-requested",
			"history-produced",
			"history-validated",
			"turn-prefix-requested",
			"turn-prefix-produced",
			"summary-assembled",
			"verification-started",
			"commit-accepted",
			"completed",
		]);
	});

	it("rejects commit before verification", () => {
		let lifecycle = createCompactionLifecycleSnapshot();
		lifecycle = transitionCompactionLifecycle(lifecycle, { type: "event-observed" });
		lifecycle = transitionCompactionLifecycle(lifecycle, { type: "auth-resolved" });
		lifecycle = transitionCompactionLifecycle(lifecycle, { type: "plan-built" });

		expect(() =>
			transitionCompactionLifecycle(lifecycle, { type: "commit-accepted" }),
		).toThrow("Invalid compaction lifecycle transition");
	});

	it("records terminal skipped and failed outcomes", () => {
		const skipped = skipCompactionLifecycle(
			createCompactionLifecycleSnapshot(),
			"invalid-event",
		);
		const failed = failCompactionLifecycle(
			transitionCompactionLifecycle(createCompactionLifecycleSnapshot(), {
				type: "event-observed",
			}),
			"provider-error",
		);

		expect(skipped.status).toBe("skipped");
		expect(skipped.history[0]).toMatchObject({ reason: "invalid-event" });
		expect(failed.status).toBe("failed");
		expect(failed.history.at(-1)).toMatchObject({ reason: "provider-error" });
	});

	it("keeps final states terminal", () => {
		for (const status of COMPACTION_LIFECYCLE_TERMINAL_STATES) {
			for (const type of COMPACTION_LIFECYCLE_ALPHABET) {
				expect(() =>
					transitionCompactionLifecycle({ status, history: [] }, { type }),
				).toThrow("Invalid compaction lifecycle transition");
			}
		}
	});
});
