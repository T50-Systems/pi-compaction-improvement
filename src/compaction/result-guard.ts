import type { FileListDetails, ValidatedExtensionCompaction } from "./types.ts";

export function buildValidatedCompaction(input: {
	summary: string;
	firstKeptEntryId: string;
	tokensBefore: number;
	details: FileListDetails;
}): ValidatedExtensionCompaction | undefined {
	const summary = input.summary.trim();
	if (!summary || !input.firstKeptEntryId || !Number.isFinite(input.tokensBefore) || input.tokensBefore < 0) {
		return undefined;
	}

	const readFiles = input.details.readFiles.filter(
		(value): value is string => typeof value === "string",
	);
	const modifiedFiles = input.details.modifiedFiles.filter(
		(value): value is string => typeof value === "string",
	);

	return {
		compaction: {
			summary,
			firstKeptEntryId: input.firstKeptEntryId,
			tokensBefore: input.tokensBefore,
			details: { readFiles, modifiedFiles },
		},
	};
}
