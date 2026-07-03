import type { FileOperationsLike } from "./types.ts";

export function computeFileLists(fileOps: FileOperationsLike): {
	readFiles: string[];
	modifiedFiles: string[];
} {
	const comparePaths = (left: string, right: string) => left.localeCompare(right);
	const modifiedFiles = [...new Set([...fileOps.edited, ...fileOps.written])].sort(comparePaths);
	const modifiedSet = new Set(modifiedFiles);
	const readFiles = [...new Set(fileOps.read)]
		.sort(comparePaths)
		.filter((path) => !modifiedSet.has(path));
	return { readFiles, modifiedFiles };
}
