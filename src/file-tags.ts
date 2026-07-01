export interface FileListState {
  readFiles: string[];
  modifiedFiles: string[];
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))].sort();
}

function parseTagBlock(summary: string | undefined, tag: "read-files" | "modified-files"): string[] {
  if (!summary) return [];
  const regex = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, "i");
  const match = regex.exec(summary);
  if (!match) return [];
  return uniqueSorted(match[1].split(/\r?\n/));
}

export function parseFileLists(summary: string | undefined): FileListState {
  return {
    readFiles: parseTagBlock(summary, "read-files"),
    modifiedFiles: parseTagBlock(summary, "modified-files"),
  };
}

export function stripFileTags(summary: string): string {
  return summary
    .replace(/\n?\s*<read-files>[\s\S]*?<\/read-files>\s*/gi, "\n")
    .replace(/\n?\s*<modified-files>[\s\S]*?<\/modified-files>\s*/gi, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function mergeFileLists(previous: FileListState, current: FileListState): FileListState {
  const modifiedFiles = uniqueSorted([...previous.modifiedFiles, ...current.modifiedFiles]);
  const modifiedSet = new Set(modifiedFiles);
  const readFiles = uniqueSorted([...previous.readFiles, ...current.readFiles]).filter((path) => !modifiedSet.has(path));
  return { readFiles, modifiedFiles };
}

export function formatFileOperations(readFiles: string[], modifiedFiles: string[]): string {
  const sections: string[] = [];
  if (readFiles.length > 0) {
    sections.push(`<read-files>\n${readFiles.join("\n")}\n</read-files>`);
  }
  if (modifiedFiles.length > 0) {
    sections.push(`<modified-files>\n${modifiedFiles.join("\n")}\n</modified-files>`);
  }
  return sections.length > 0 ? `\n\n${sections.join("\n\n")}` : "";
}
