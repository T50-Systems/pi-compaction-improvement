import type { FileOperationsLike, SafeBeforeCompactEvent } from "./types.ts";

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function toStringOrUndefined(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function toFiniteNumberOrUndefined(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function normalizeStringSet(value: unknown): Set<string> {
	if (!value || typeof (value as Iterable<unknown>)[Symbol.iterator] !== "function") {
		return new Set();
	}
	return new Set(
		[...(value as Iterable<unknown>)].filter(
			(item): item is string => typeof item === "string" && item.length > 0,
		),
	);
}

export function normalizeFileOperations(value: unknown): FileOperationsLike {
	const record = isRecord(value) ? value : {};
	return {
		read: normalizeStringSet(record.read),
		written: normalizeStringSet(record.written),
		edited: normalizeStringSet(record.edited),
	};
}

export function isAbortSignalLike(value: unknown): value is AbortSignal {
	return (
		isRecord(value) &&
		typeof value.aborted === "boolean" &&
		typeof value.addEventListener === "function"
	);
}

export function parseBeforeCompactEvent(event: unknown): SafeBeforeCompactEvent | undefined {
	if (!isRecord(event) || !isRecord(event.preparation)) return undefined;

	const preparation = event.preparation;
	const messagesToSummarize = Array.isArray(preparation.messagesToSummarize)
		? preparation.messagesToSummarize
		: undefined;
	const turnPrefixMessages = Array.isArray(preparation.turnPrefixMessages)
		? preparation.turnPrefixMessages
		: undefined;
	const tokensBefore = toFiniteNumberOrUndefined(preparation.tokensBefore);
	const reserveTokens = isRecord(preparation.settings)
		? toFiniteNumberOrUndefined(preparation.settings.reserveTokens)
		: undefined;

	if (!messagesToSummarize || !turnPrefixMessages || tokensBefore === undefined) {
		return undefined;
	}

	return {
		preparation: {
			messagesToSummarize,
			turnPrefixMessages,
			firstKeptEntryId: toStringOrUndefined(preparation.firstKeptEntryId) ?? "",
			tokensBefore,
			previousSummary: toStringOrUndefined(preparation.previousSummary),
			fileOps: normalizeFileOperations(preparation.fileOps),
			settings: { reserveTokens: reserveTokens ?? 2048 },
		},
		signal: isAbortSignalLike(event.signal) ? event.signal : undefined,
		customInstructions: toStringOrUndefined(event.customInstructions),
	};
}

export type ToolResultLike = { content?: unknown; details?: unknown };

export function isToolResultLike(value: unknown): value is ToolResultLike {
	return isRecord(value) && value.type === "toolResult";
}
