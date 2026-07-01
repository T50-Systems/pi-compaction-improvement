import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface PersistCompactionStateInput {
  cwd: string;
  configuredStateRepoPath?: string;
  phase: "before" | "after";
  trigger?: string | null;
  source?: "extension" | "core" | null;
  tokensBefore?: number;
  firstKeptEntryId?: string;
  readFiles?: readonly string[];
  modifiedFiles?: readonly string[];
  summary?: string;
}

interface PersistedActiveCompactState {
  version: number;
  status: "in_progress" | "interrupted";
  interruptedBy: "compaction";
  updatedAt: string;
  sourceOfTruth: "pi-compaction-improvement";
  project: {
    workingDirectory: string;
  };
  compaction: {
    phase: "before" | "after";
    trigger: string | null;
    source: "extension" | "core" | null;
    tokensBefore?: number;
    firstKeptEntryId?: string;
  };
  resume: {
    nextStep: string;
    files: string[];
  };
  summary?: string;
}

function expandHome(input: string): string {
  if (!input.startsWith("~")) return input;
  const home = process.env.USERPROFILE ?? process.env.HOME;
  if (!home) return input;
  return path.join(home, input.slice(1));
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function detectPackageStateRepo(): Promise<string | undefined> {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const required = [
    path.join(packageRoot, "ACTIVE-COMPACT-STATE.json"),
    path.join(packageRoot, "ACTIVE-COMPACT-STATE.md"),
    path.join(packageRoot, "checkpoints"),
  ];
  const allExist = (await Promise.all(required.map((entry) => pathExists(entry)))).every(Boolean);
  return allExist ? packageRoot : undefined;
}

export async function resolveStateRepoPath(configuredStateRepoPath: string | undefined, cwd: string): Promise<string | undefined> {
  if (configuredStateRepoPath) {
    return path.resolve(cwd, expandHome(configuredStateRepoPath));
  }
  return detectPackageStateRepo();
}

function buildResumeFiles(readFiles: readonly string[], modifiedFiles: readonly string[]): string[] {
  return [...new Set([...modifiedFiles, ...readFiles])].sort();
}

function buildNextStep(phase: "before" | "after"): string {
  return phase === "before"
    ? "Read ACTIVE-COMPACT-STATE.md and wait for the compaction summary/checkpoint to finish writing before resuming work."
    : "Read ACTIVE-COMPACT-STATE.md, then continue directly from the stored compaction summary and listed files.";
}

function buildMarkdown(state: PersistedActiveCompactState): string {
  const fileLines = state.resume.files.length > 0 ? state.resume.files.map((file) => `- \`${file}\``) : ["- (none)"];
  return [
    "# Active compact state",
    "",
    `- Status: ${state.status}`,
    `- Interrupted by: ${state.interruptedBy}`,
    `- Updated at: ${state.updatedAt}`,
    `- Working directory: \`${state.project.workingDirectory}\``,
    `- Compaction phase: ${state.compaction.phase}`,
    `- Trigger: ${state.compaction.trigger ?? "unknown"}`,
    `- Source: ${state.compaction.source ?? "unknown"}`,
    typeof state.compaction.tokensBefore === "number" ? `- Tokens before: ${state.compaction.tokensBefore}` : undefined,
    state.compaction.firstKeptEntryId ? `- First kept entry: \`${state.compaction.firstKeptEntryId}\`` : undefined,
    "",
    "## Resume files",
    ...fileLines,
    "",
    "## Immediate next action",
    state.resume.nextStep,
    "",
    "## Stored summary",
    state.summary?.trim() || "(pre-compaction checkpoint only; summary not yet available)",
    "",
  ]
    .filter((line): line is string => typeof line === "string")
    .join("\n");
}

function createTimestampToken(iso: string): string {
  return iso.replace(/[:]/g, "-").replace(/\..+/, "");
}

export async function persistCompactionState(input: PersistCompactionStateInput): Promise<string | undefined> {
  const stateRepoPath = await resolveStateRepoPath(input.configuredStateRepoPath, input.cwd);
  if (!stateRepoPath) return undefined;

  const readFiles = [...(input.readFiles ?? [])];
  const modifiedFiles = [...(input.modifiedFiles ?? [])];
  const now = new Date().toISOString();
  const state: PersistedActiveCompactState = {
    version: 1,
    status: "interrupted",
    interruptedBy: "compaction",
    updatedAt: now,
    sourceOfTruth: "pi-compaction-improvement",
    project: {
      workingDirectory: input.cwd,
    },
    compaction: {
      phase: input.phase,
      trigger: input.trigger ?? null,
      source: input.source ?? null,
      ...(typeof input.tokensBefore === "number" ? { tokensBefore: input.tokensBefore } : {}),
      ...(input.firstKeptEntryId ? { firstKeptEntryId: input.firstKeptEntryId } : {}),
    },
    resume: {
      nextStep: buildNextStep(input.phase),
      files: buildResumeFiles(readFiles, modifiedFiles),
    },
    ...(input.summary?.trim() ? { summary: input.summary.trim() } : {}),
  };

  const activeJsonPath = path.join(stateRepoPath, "ACTIVE-COMPACT-STATE.json");
  const activeMdPath = path.join(stateRepoPath, "ACTIVE-COMPACT-STATE.md");
  const checkpointsDir = path.join(stateRepoPath, "checkpoints");
  const checkpointPath = path.join(checkpointsDir, `${createTimestampToken(now)}-autocompact-${input.phase}.md`);

  await fs.mkdir(checkpointsDir, { recursive: true });
  await fs.writeFile(activeJsonPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  const markdown = buildMarkdown(state);
  await fs.writeFile(activeMdPath, `${markdown}\n`, "utf8");
  await fs.writeFile(checkpointPath, `${markdown}\n`, "utf8");
  return stateRepoPath;
}
