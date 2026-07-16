import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { COMPACTION_INVARIANTS } from "./invariants.ts";
import {
	LIFECYCLE_DIAGNOSTIC_FALLBACK_CATEGORIES,
	LIFECYCLE_DIAGNOSTIC_TERMINALS,
	LIFECYCLE_DIAGNOSTIC_TRIGGERS,
	MAX_LIFECYCLE_DIAGNOSTICS,
	type CompactionLifecycleDiagnostic,
} from "./lifecycle-diagnostics.ts";

export const LIFECYCLE_DIAGNOSTIC_STORE_VERSION = 1;
export const LIFECYCLE_DIAGNOSTIC_STORE_FILENAME =
	"pi-autocompact-v2-diagnostics.json";
export const MAX_LIFECYCLE_DIAGNOSTIC_STORE_BYTES = 64 * 1024;

const ENVELOPE_KEYS = ["entries", "version"] as const;
const REQUIRED_ENTRY_KEYS = [
	"durationMs",
	"retryCount",
	"terminalState",
	"timestamp",
	"triggerReason",
	"violatedInvariants",
] as const;
const OPTIONAL_ENTRY_KEYS = ["fallbackCategory"] as const;
const ENTRY_KEYS = [...REQUIRED_ENTRY_KEYS, ...OPTIONAL_ENTRY_KEYS] as const;
const TEMP_SUFFIX = ".tmp";

interface LifecycleDiagnosticEnvelopeV1 {
	version: typeof LIFECYCLE_DIAGNOSTIC_STORE_VERSION;
	entries: CompactionLifecycleDiagnostic[];
}

export function getLifecycleDiagnosticStorePath(): string {
	return path.join(
		homedir(),
		".pi",
		"agent",
		LIFECYCLE_DIAGNOSTIC_STORE_FILENAME,
	);
}

export function parseLifecycleDiagnosticEnvelope(
	value: unknown,
): CompactionLifecycleDiagnostic[] | null {
	if (!isExactRecord(value, ENVELOPE_KEYS)) return null;
	if (value.version !== LIFECYCLE_DIAGNOSTIC_STORE_VERSION) return null;
	if (!Array.isArray(value.entries)) return null;
	if (value.entries.length > MAX_LIFECYCLE_DIAGNOSTICS) return null;

	const entries: CompactionLifecycleDiagnostic[] = [];
	for (const candidate of value.entries) {
		const entry = parseLifecycleDiagnostic(candidate);
		if (!entry) return null;
		entries.push(entry);
	}
	return entries;
}

export function serializeLifecycleDiagnosticEnvelope(
	history: readonly CompactionLifecycleDiagnostic[],
): string {
	const entries = history
		.map((entry) => parseLifecycleDiagnostic(toClosedEntry(entry)))
		.filter((entry): entry is CompactionLifecycleDiagnostic => entry !== null)
		.slice(-MAX_LIFECYCLE_DIAGNOSTICS);
	const envelope: LifecycleDiagnosticEnvelopeV1 = {
		version: LIFECYCLE_DIAGNOSTIC_STORE_VERSION,
		entries,
	};
	return `${JSON.stringify(envelope, null, 2)}\n`;
}

export async function loadPersistedLifecycleDiagnostics(): Promise<
	CompactionLifecycleDiagnostic[]
> {
	const filePath = getLifecycleDiagnosticStorePath();
	try {
		const metadata = await fs.stat(filePath);
		if (metadata.size > MAX_LIFECYCLE_DIAGNOSTIC_STORE_BYTES) return [];
		const text = await fs.readFile(filePath, "utf8");
		return parseLifecycleDiagnosticEnvelope(JSON.parse(text) as unknown) ?? [];
	} catch {
		return [];
	}
}

export async function persistLifecycleDiagnostics(
	history: readonly CompactionLifecycleDiagnostic[],
): Promise<void> {
	const filePath = getLifecycleDiagnosticStorePath();
	const temporaryPath = `${filePath}${TEMP_SUFFIX}`;
	try {
		const serialized = serializeLifecycleDiagnosticEnvelope(history);
		if (Buffer.byteLength(serialized, "utf8") > MAX_LIFECYCLE_DIAGNOSTIC_STORE_BYTES) {
			return;
		}
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(temporaryPath, serialized, {
			encoding: "utf8",
			mode: 0o600,
		});
		await fs.rename(temporaryPath, filePath);
	} catch {
		await removeBestEffort(temporaryPath);
	}
}

export async function clearPersistedLifecycleDiagnostics(): Promise<void> {
	const filePath = getLifecycleDiagnosticStorePath();
	await Promise.all([
		removeBestEffort(filePath),
		removeBestEffort(`${filePath}${TEMP_SUFFIX}`),
	]);
}

function parseLifecycleDiagnostic(
	value: unknown,
): CompactionLifecycleDiagnostic | null {
	if (!isAllowedEntryRecord(value)) return null;
	if (!isIsoTimestamp(value.timestamp)) return null;
	if (!includes(LIFECYCLE_DIAGNOSTIC_TRIGGERS, value.triggerReason)) return null;
	if (!includes(LIFECYCLE_DIAGNOSTIC_TERMINALS, value.terminalState)) return null;
	if (!isNonNegativeSafeInteger(value.durationMs)) return null;
	if (!isNonNegativeSafeInteger(value.retryCount)) return null;
	if (!Array.isArray(value.violatedInvariants)) return null;
	if (value.violatedInvariants.length > COMPACTION_INVARIANTS.length) return null;
	if (!value.violatedInvariants.every((item) => includes(COMPACTION_INVARIANTS, item))) {
		return null;
	}
	if (new Set(value.violatedInvariants).size !== value.violatedInvariants.length) {
		return null;
	}
	if (
		"fallbackCategory" in value &&
		!includes(
			LIFECYCLE_DIAGNOSTIC_FALLBACK_CATEGORIES,
			value.fallbackCategory,
		)
	) {
		return null;
	}
	return toClosedEntry(value as unknown as CompactionLifecycleDiagnostic);
}

function toClosedEntry(
	entry: CompactionLifecycleDiagnostic,
): CompactionLifecycleDiagnostic {
	return {
		timestamp: entry.timestamp,
		triggerReason: entry.triggerReason,
		terminalState: entry.terminalState,
		durationMs: entry.durationMs,
		retryCount: entry.retryCount,
		violatedInvariants: [...entry.violatedInvariants],
		...(entry.fallbackCategory
			? { fallbackCategory: entry.fallbackCategory }
			: {}),
	};
}

function isAllowedEntryRecord(
	value: unknown,
): value is Record<(typeof ENTRY_KEYS)[number], unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const keys = Object.keys(value);
	return REQUIRED_ENTRY_KEYS.every((key) => keys.includes(key)) &&
		keys.every((key) => (ENTRY_KEYS as readonly string[]).includes(key));
}

function isExactRecord<K extends string>(
	value: unknown,
	keys: readonly K[],
): value is Record<K, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const actual = Object.keys(value);
	return actual.length === keys.length &&
		actual.every((key) => (keys as readonly string[]).includes(key));
}

function isIsoTimestamp(value: unknown): value is string {
	if (typeof value !== "string" || value.length !== 24) return false;
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function includes<T>(values: readonly T[], value: unknown): value is T {
	return (values as readonly unknown[]).includes(value);
}

async function removeBestEffort(filePath: string): Promise<void> {
	try {
		await fs.unlink(filePath);
	} catch {
		// Persistence is observational and must never affect compaction fallback.
	}
}
