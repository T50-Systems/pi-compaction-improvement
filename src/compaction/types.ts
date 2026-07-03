import type { AutoCompactState, CompactionPhase, StatusSnapshot } from "../state.ts";

export type { AutoCompactState, CompactionPhase, StatusSnapshot } from "../state.ts";

export interface FileOperationsLike {
	read: Set<string>;
	written: Set<string>;
	edited: Set<string>;
}

export interface SafeCompactionPreparation {
	messagesToSummarize: unknown[];
	turnPrefixMessages: unknown[];
	firstKeptEntryId: string;
	tokensBefore: number;
	previousSummary: string | undefined;
	fileOps: FileOperationsLike;
	settings: { reserveTokens: number };
}

export interface SafeBeforeCompactEvent {
	preparation: SafeCompactionPreparation;
	signal: AbortSignal | undefined;
	customInstructions: string | undefined;
}

export interface FileListDetails {
	readFiles: string[];
	modifiedFiles: string[];
}

export interface ValidatedExtensionCompaction {
	compaction: {
		summary: string;
		firstKeptEntryId: string;
		tokensBefore: number;
		details: FileListDetails;
	};
}

export interface CompactionRequest {
	turnIndex: number;
	reason: string;
	customInstructions?: string;
}

export interface ScheduledAutocompact {
	timer: ReturnType<typeof setTimeout> | null;
	generation: number;
	lastScheduledTurn: number | null;
}

export type NotifyType = "info" | "warning" | "error";

export type MutableCompactionState = AutoCompactState;
export type MutableCompactionPhase = CompactionPhase;
export type MutableStatusSnapshot = StatusSnapshot;
