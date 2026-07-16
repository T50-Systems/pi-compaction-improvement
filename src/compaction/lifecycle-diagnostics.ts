import type { CompactionInvariant } from "./invariants.ts";
import type { SafeCompactionReason } from "./types.ts";

export const MAX_LIFECYCLE_DIAGNOSTICS = 20;

export type LifecycleDiagnosticTrigger =
	| SafeCompactionReason
	| "incompatible-event"
	| "missing-model"
	| "missing-auth"
	| "empty-input";

export const LIFECYCLE_DIAGNOSTIC_TRIGGERS = [
	"manual",
	"overflow",
	"threshold",
	"incompatible-event",
	"missing-model",
	"missing-auth",
	"empty-input",
] as const satisfies readonly LifecycleDiagnosticTrigger[];

export type LifecycleDiagnosticTerminal =
	| "skipped"
	| "failed"
	| "fallback"
	| "completed";

export const LIFECYCLE_DIAGNOSTIC_TERMINALS = [
	"skipped",
	"failed",
	"fallback",
	"completed",
] as const satisfies readonly LifecycleDiagnosticTerminal[];

export type LifecycleFallbackCategory =
	| "incompatible-event"
	| "missing-model"
	| "missing-auth"
	| "empty-input"
	| "empty-summary"
	| "provider-error"
	| "timeout"
	| "aborted"
	| "invalid-summary"
	| "invalid-result"
	| "verification-failed"
	| "unexpected-error";

export const LIFECYCLE_DIAGNOSTIC_FALLBACK_CATEGORIES = [
	"incompatible-event",
	"missing-model",
	"missing-auth",
	"empty-input",
	"empty-summary",
	"provider-error",
	"timeout",
	"aborted",
	"invalid-summary",
	"invalid-result",
	"verification-failed",
	"unexpected-error",
] as const satisfies readonly LifecycleFallbackCategory[];

/**
 * Deliberately closed, privacy-safe diagnostic schema. It has no field capable of
 * storing prompts, summaries, file contents, headers, API keys, or credentials.
 */
export interface CompactionLifecycleDiagnostic {
	timestamp: string;
	triggerReason: LifecycleDiagnosticTrigger;
	terminalState: LifecycleDiagnosticTerminal;
	durationMs: number;
	retryCount: number;
	violatedInvariants: CompactionInvariant[];
	fallbackCategory?: LifecycleFallbackCategory;
}

export interface LifecycleDiagnosticInput {
	triggerReason: LifecycleDiagnosticTrigger;
	terminalState: LifecycleDiagnosticTerminal;
	startedAt: number;
	finishedAt?: number;
	retryCount?: number;
	violatedInvariants?: readonly CompactionInvariant[];
	fallbackCategory?: LifecycleFallbackCategory;
}

export function appendLifecycleDiagnostic(
	history: CompactionLifecycleDiagnostic[],
	input: LifecycleDiagnosticInput,
): void {
	const finishedAt = input.finishedAt ?? Date.now();
	const entry: CompactionLifecycleDiagnostic = {
		timestamp: new Date(finishedAt).toISOString(),
		triggerReason: input.triggerReason,
		terminalState: input.terminalState,
		durationMs: Math.max(0, finishedAt - input.startedAt),
		retryCount: Math.max(0, Math.trunc(input.retryCount ?? 0)),
		violatedInvariants: [...new Set(input.violatedInvariants ?? [])],
		...(input.fallbackCategory
			? { fallbackCategory: input.fallbackCategory }
			: {}),
	};
	history.push(entry);
	if (history.length > MAX_LIFECYCLE_DIAGNOSTICS) {
		history.splice(0, history.length - MAX_LIFECYCLE_DIAGNOSTICS);
	}
}

export function clearLifecycleDiagnostics(
	history: CompactionLifecycleDiagnostic[],
): void {
	history.splice(0, history.length);
}
