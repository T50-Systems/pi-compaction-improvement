export type CompactionLifecycleStatus =
	| "idle"
	| "observed"
	| "authenticated"
	| "planned"
	| "mode-resolved"
	| "history-producing"
	| "history-produced"
	| "history-validated"
	| "turn-prefix-producing"
	| "turn-prefix-produced"
	| "assembled"
	| "verifying"
	| "committed"
	| "completed"
	| "skipped"
	| "failed";

export type CompactionLifecycleEventType =
	| "event-observed"
	| "auth-resolved"
	| "plan-built"
	| "mode-resolved"
	| "history-requested"
	| "history-produced"
	| "history-validated"
	| "turn-prefix-requested"
	| "turn-prefix-produced"
	| "summary-assembled"
	| "verification-started"
	| "commit-accepted"
	| "completed"
	| "skipped"
	| "failed";

export interface CompactionLifecycleEvent {
	type: CompactionLifecycleEventType;
	reason?: string;
	at?: number;
}

export interface CompactionLifecycleSnapshot {
	status: CompactionLifecycleStatus;
	history: Array<CompactionLifecycleEvent & { from: CompactionLifecycleStatus; to: CompactionLifecycleStatus }>;
}

const TRANSITIONS: Record<CompactionLifecycleStatus, Partial<Record<CompactionLifecycleEventType, CompactionLifecycleStatus>>> = {
	idle: {
		"event-observed": "observed",
		skipped: "skipped",
		failed: "failed",
	},
	observed: {
		"auth-resolved": "authenticated",
		skipped: "skipped",
		failed: "failed",
	},
	authenticated: {
		"plan-built": "planned",
		skipped: "skipped",
		failed: "failed",
	},
	planned: {
		"mode-resolved": "mode-resolved",
		failed: "failed",
	},
	"mode-resolved": {
		"history-requested": "history-producing",
		failed: "failed",
	},
	"history-producing": {
		"history-produced": "history-produced",
		failed: "failed",
	},
	"history-produced": {
		"history-validated": "history-validated",
		failed: "failed",
	},
	"history-validated": {
		"turn-prefix-requested": "turn-prefix-producing",
		failed: "failed",
	},
	"turn-prefix-producing": {
		"turn-prefix-produced": "turn-prefix-produced",
		failed: "failed",
	},
	"turn-prefix-produced": {
		"summary-assembled": "assembled",
		failed: "failed",
	},
	assembled: {
		"verification-started": "verifying",
		failed: "failed",
	},
	verifying: {
		"commit-accepted": "committed",
		failed: "failed",
	},
	committed: {
		completed: "completed",
		failed: "failed",
	},
	completed: {},
	skipped: {},
	failed: {},
};

export function createCompactionLifecycleSnapshot(): CompactionLifecycleSnapshot {
	return { status: "idle", history: [] };
}

export function transitionCompactionLifecycle(
	snapshot: CompactionLifecycleSnapshot,
	event: CompactionLifecycleEvent,
): CompactionLifecycleSnapshot {
	const to = TRANSITIONS[snapshot.status][event.type];
	if (!to) {
		throw new Error(
			`Invalid compaction lifecycle transition: ${snapshot.status} + ${event.type}`,
		);
	}
	return {
		status: to,
		history: [
			...snapshot.history,
			{
				...event,
				at: event.at ?? Date.now(),
				from: snapshot.status,
				to,
			},
		],
	};
}

export function failCompactionLifecycle(
	snapshot: CompactionLifecycleSnapshot,
	reason?: string,
): CompactionLifecycleSnapshot {
	if (snapshot.status === "failed") return snapshot;
	return transitionCompactionLifecycle(snapshot, { type: "failed", reason });
}

export function skipCompactionLifecycle(
	snapshot: CompactionLifecycleSnapshot,
	reason?: string,
): CompactionLifecycleSnapshot {
	if (snapshot.status === "skipped") return snapshot;
	return transitionCompactionLifecycle(snapshot, { type: "skipped", reason });
}
