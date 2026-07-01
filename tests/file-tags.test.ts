import { describe, expect, it } from "vitest";
import { formatFileOperations, mergeFileLists, parseFileLists, stripFileTags } from "../src/file-tags.ts";

describe("file tag helpers", () => {
  it("parses prior file tags", () => {
    const parsed = parseFileLists(`Hello\n\n<read-files>\na.ts\nb.ts\n</read-files>\n\n<modified-files>\nc.ts\n</modified-files>`);
    expect(parsed.readFiles).toEqual(["a.ts", "b.ts"]);
    expect(parsed.modifiedFiles).toEqual(["c.ts"]);
  });

  it("merges and de-duplicates file lists", () => {
    const merged = mergeFileLists(
      { readFiles: ["a.ts", "b.ts"], modifiedFiles: ["c.ts"] },
      { readFiles: ["c.ts", "d.ts"], modifiedFiles: ["b.ts"] },
    );
    expect(merged.readFiles).toEqual(["a.ts", "d.ts"]);
    expect(merged.modifiedFiles).toEqual(["b.ts", "c.ts"]);
  });

  it("strips file tags before re-appending them", () => {
    const cleaned = stripFileTags(`## Goal\nDo work\n\n<read-files>\na.ts\n</read-files>\n\n<modified-files>\nb.ts\n</modified-files>`);
    expect(cleaned).toBe("## Goal\nDo work");
  });

  it("formats merged file operations", () => {
    expect(formatFileOperations(["a.ts"], ["b.ts"])).toContain("<read-files>");
    expect(formatFileOperations(["a.ts"], ["b.ts"])).toContain("<modified-files>");
  });
});
