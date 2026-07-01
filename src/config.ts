import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface AutoCompactConfig {
  enabled: boolean;
  reserveTokens: number;
  softBufferTokens: number;
  emergencyBufferTokens: number;
  minDeltaTokens: number;
  rapidGrowthMinPercent: number;
  minGrowthStepTokens: number;
  sustainedGrowthTurns: number;
  sustainedGrowthMinPercent: number;
  minTurnsBetweenCompacts: number;
  minToolResultTokens: number;
  minToolResults: number;
  debug: boolean;
  showStatus: boolean;
  stateRepoPath?: string;
}

export interface ConfigLoadResult {
  config: AutoCompactConfig;
  globalPath: string;
  projectPath: string;
  activeProjectOverride: boolean;
  warnings: string[];
}

export type ConfigScope = "global" | "project";

export const DEFAULT_CONFIG: AutoCompactConfig = {
  enabled: true,
  reserveTokens: 16_384,
  softBufferTokens: 8_192,
  emergencyBufferTokens: 2_048,
  minDeltaTokens: 6_000,
  rapidGrowthMinPercent: 60,
  minGrowthStepTokens: 1_500,
  sustainedGrowthTurns: 3,
  sustainedGrowthMinPercent: 70,
  minTurnsBetweenCompacts: 2,
  minToolResultTokens: 8_000,
  minToolResults: 2,
  debug: false,
  showStatus: true,
  stateRepoPath: undefined,
};

type RawConfig = Partial<Record<keyof AutoCompactConfig, unknown>>;

const INTEGER_FIELDS: Array<keyof AutoCompactConfig> = [
  "reserveTokens",
  "softBufferTokens",
  "emergencyBufferTokens",
  "minDeltaTokens",
  "rapidGrowthMinPercent",
  "minGrowthStepTokens",
  "sustainedGrowthTurns",
  "sustainedGrowthMinPercent",
  "minTurnsBetweenCompacts",
  "minToolResultTokens",
  "minToolResults",
];

const BOOLEAN_FIELDS: Array<keyof AutoCompactConfig> = ["enabled", "debug", "showStatus"];
const STRING_FIELDS: Array<keyof AutoCompactConfig> = ["stateRepoPath"];

function normalizeInteger(value: unknown, fallback: number, minimum: number, maximum?: number): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) return fallback;
  const rounded = Math.round(numeric);
  const clamped = maximum === undefined ? Math.max(minimum, rounded) : Math.min(maximum, Math.max(minimum, rounded));
  return clamped;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeString(value: unknown, fallback?: string): string | undefined {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeConfig(raw?: RawConfig | null): AutoCompactConfig {
  const input = raw ?? {};
  const config: AutoCompactConfig = {
    enabled: normalizeBoolean(input.enabled, DEFAULT_CONFIG.enabled),
    reserveTokens: normalizeInteger(input.reserveTokens, DEFAULT_CONFIG.reserveTokens, 1024),
    softBufferTokens: normalizeInteger(input.softBufferTokens, DEFAULT_CONFIG.softBufferTokens, 0),
    emergencyBufferTokens: normalizeInteger(input.emergencyBufferTokens, DEFAULT_CONFIG.emergencyBufferTokens, 0),
    minDeltaTokens: normalizeInteger(input.minDeltaTokens, DEFAULT_CONFIG.minDeltaTokens, 0),
    rapidGrowthMinPercent: normalizeInteger(input.rapidGrowthMinPercent, DEFAULT_CONFIG.rapidGrowthMinPercent, 1, 100),
    minGrowthStepTokens: normalizeInteger(input.minGrowthStepTokens, DEFAULT_CONFIG.minGrowthStepTokens, 0),
    sustainedGrowthTurns: normalizeInteger(input.sustainedGrowthTurns, DEFAULT_CONFIG.sustainedGrowthTurns, 1),
    sustainedGrowthMinPercent: normalizeInteger(input.sustainedGrowthMinPercent, DEFAULT_CONFIG.sustainedGrowthMinPercent, 1, 100),
    minTurnsBetweenCompacts: normalizeInteger(input.minTurnsBetweenCompacts, DEFAULT_CONFIG.minTurnsBetweenCompacts, 0),
    minToolResultTokens: normalizeInteger(input.minToolResultTokens, DEFAULT_CONFIG.minToolResultTokens, 0),
    minToolResults: normalizeInteger(input.minToolResults, DEFAULT_CONFIG.minToolResults, 0),
    debug: normalizeBoolean(input.debug, DEFAULT_CONFIG.debug),
    showStatus: normalizeBoolean(input.showStatus, DEFAULT_CONFIG.showStatus),
    stateRepoPath: normalizeString(input.stateRepoPath, DEFAULT_CONFIG.stateRepoPath),
  };

  if (config.softBufferTokens < config.emergencyBufferTokens) {
    config.softBufferTokens = config.emergencyBufferTokens;
  }
  return config;
}

async function readJsonFile(filePath: string): Promise<RawConfig | null> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("config must be a JSON object");
    }
    return parsed as RawConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function getGlobalConfigPath(): string {
  return path.join(homedir(), ".pi", "agent", "pi-autocompact-v2.json");
}

export function getProjectConfigPath(cwd: string): string {
  return path.join(cwd, ".pi", "pi-autocompact-v2.json");
}

export async function loadScopeConfig(scope: ConfigScope, cwd: string): Promise<{ path: string; exists: boolean; raw: RawConfig }> {
  const filePath = scope === "global" ? getGlobalConfigPath() : getProjectConfigPath(cwd);
  const raw = await readJsonFile(filePath);
  return {
    path: filePath,
    exists: raw !== null,
    raw: raw ?? {},
  };
}

export async function loadEffectiveConfig(cwd: string, projectTrusted: boolean): Promise<ConfigLoadResult> {
  const globalPath = getGlobalConfigPath();
  const projectPath = getProjectConfigPath(cwd);
  const warnings: string[] = [];

  let globalRaw: RawConfig = {};
  let projectRaw: RawConfig = {};
  let activeProjectOverride = false;

  try {
    globalRaw = (await readJsonFile(globalPath)) ?? {};
  } catch (error) {
    warnings.push(`Global config ignored: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (projectTrusted) {
    try {
      const raw = await readJsonFile(projectPath);
      if (raw) {
        projectRaw = raw;
        activeProjectOverride = true;
      }
    } catch (error) {
      warnings.push(`Project config ignored: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    config: normalizeConfig({ ...globalRaw, ...projectRaw }),
    globalPath,
    projectPath,
    activeProjectOverride,
    warnings,
  };
}

export async function writeScopeConfig(scope: ConfigScope, cwd: string, raw: RawConfig): Promise<string> {
  const filePath = scope === "global" ? getGlobalConfigPath() : getProjectConfigPath(cwd);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  return filePath;
}

export async function resetScopeConfig(scope: ConfigScope, cwd: string): Promise<string> {
  const filePath = scope === "global" ? getGlobalConfigPath() : getProjectConfigPath(cwd);
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return filePath;
}

export function parseConfigEditorText(text: string): RawConfig {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("config must be a JSON object");
  }
  return parsed as RawConfig;
}

export function formatConfigEditorText(raw: RawConfig): string {
  return `${JSON.stringify(raw, null, 2)}\n`;
}

export function formatConfigSummary(config: AutoCompactConfig): string {
  return [
    `enabled=${config.enabled}`,
    `reserve=${config.reserveTokens}`,
    `softBuffer=${config.softBufferTokens}`,
    `emergencyBuffer=${config.emergencyBufferTokens}`,
    `minDelta=${config.minDeltaTokens}`,
    `cooldownTurns=${config.minTurnsBetweenCompacts}`,
    `stateRepo=${config.stateRepoPath ?? "auto"}`,
  ].join(" | ");
}

export function coerceRawConfigValue(key: keyof AutoCompactConfig, value: unknown): string | number | boolean | undefined {
  if (INTEGER_FIELDS.includes(key)) {
    const normalized = normalizeInteger(value, Number.NaN, 0);
    return Number.isNaN(normalized) ? undefined : normalized;
  }
  if (BOOLEAN_FIELDS.includes(key)) {
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "on"].includes(normalized)) return true;
      if (["false", "0", "no", "off"].includes(normalized)) return false;
      return undefined;
    }
    return typeof value === "boolean" ? value : undefined;
  }
  if (STRING_FIELDS.includes(key)) {
    return normalizeString(value);
  }
  return undefined;
}
