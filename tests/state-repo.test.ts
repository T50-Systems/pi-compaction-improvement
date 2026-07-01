import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { persistCompactionState } from "../src/state-repo.ts";

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("persistCompactionState", () => {
  it("writes active state files and a timestamped checkpoint", async () => {
    const repoDir = await mkdtemp(join(tmpdir(), "pi-compaction-state-"));
    createdDirs.push(repoDir);

    const resolved = await persistCompactionState({
      cwd: "C:/dev/pi/pi-gui",
      configuredStateRepoPath: repoDir,
      phase: "after",
      trigger: "soft-threshold",
      source: "extension",
      tokensBefore: 12345,
      firstKeptEntryId: "entry-1",
      readFiles: ["a.ts"],
      modifiedFiles: ["b.ts"],
      summary: "## Goal\nKeep working",
    });

    expect(resolved).toBe(repoDir);

    const activeJson = await readFile(join(repoDir, "ACTIVE-COMPACT-STATE.json"), "utf8");
    const activeMd = await readFile(join(repoDir, "ACTIVE-COMPACT-STATE.md"), "utf8");
    const checkpointDir = join(repoDir, "checkpoints");
    const checkpoints = await readdir(checkpointDir);
    const checkpointMd = await readFile(join(checkpointDir, checkpoints[0]!), "utf8");

    expect(activeJson).toContain('"trigger": "soft-threshold"');
    expect(activeJson).toContain('"workingDirectory": "C:/dev/pi/pi-gui"');
    expect(activeMd).toContain("## Stored summary");
    expect(activeMd).toContain("## Goal");
    expect(checkpoints.length).toBe(1);
    expect(checkpointMd).toContain("soft-threshold");
  });
});
