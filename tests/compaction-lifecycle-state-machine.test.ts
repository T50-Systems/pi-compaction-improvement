import { describe, expect, it } from "vitest";
import {
	createCompactionLifecycleSnapshot,
	failCompactionLifecycle,
	skipCompactionLifecycle,
	transitionCompactionLifecycle,
} from "../src/compaction/lifecycle-state-machine.ts";

describe("compaction lifecycle state machine", () => {
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
});
