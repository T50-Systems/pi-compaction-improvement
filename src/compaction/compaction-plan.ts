import type { AutoCompactState } from "../state.ts";
import type {
	FileListDetails,
	SafeCompactionPreparation,
	SafeCompactionReason,
} from "./types.ts";

export interface CompactionPlan {
	reason: SafeCompactionReason;
	trigger: string;
	firstKeptEntryId: string;
	tokensBefore: number;
	messageCounts: {
		history: number;
		turnPrefix: number;
		total: number;
	};
	previousSummaryPresent: boolean;
	splitTurn: boolean;
	willRetry: boolean;
	customInstructionsPresent: boolean;
	mustPreserve: {
		sections: string[];
		fileLists: FileListDetails;
		turnPrefixContext: boolean;
	};
	audit: {
		createdAt: number;
		planVersion: 1;
	};
}

export function buildCompactionPlan(input: {
	preparation: SafeCompactionPreparation;
	state: AutoCompactState;
	reason: SafeCompactionReason;
	willRetry: boolean;
	customInstructions?: string;
	fileLists: FileListDetails;
	now?: number;
}): CompactionPlan {
	const history = input.preparation.messagesToSummarize.length;
	const turnPrefix = input.preparation.turnPrefixMessages.length;
	return {
		reason: input.reason,
		trigger: input.state.lastCompactionReason ?? "unknown",
		firstKeptEntryId: input.preparation.firstKeptEntryId,
		tokensBefore: input.preparation.tokensBefore,
		messageCounts: {
			history,
			turnPrefix,
			total: history + turnPrefix,
		},
		previousSummaryPresent: Boolean(input.preparation.previousSummary?.trim()),
		splitTurn: turnPrefix > 0,
		willRetry: input.willRetry,
		customInstructionsPresent: Boolean(input.customInstructions?.trim()),
		mustPreserve: {
			sections: [
				"Goal",
				"Progress",
				"Immediate Next Action",
				"Continuation Contract",
				"Critical Context",
			],
			fileLists: input.fileLists,
			turnPrefixContext: turnPrefix > 0,
		},
		audit: {
			createdAt: input.now ?? Date.now(),
			planVersion: 1,
		},
	};
}
