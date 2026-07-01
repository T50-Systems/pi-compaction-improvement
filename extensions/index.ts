import { complete } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";
import {
  coerceRawConfigValue,
  DEFAULT_CONFIG,
  formatConfigEditorText,
  formatConfigSummary,
  loadEffectiveConfig,
  loadScopeConfig,
  parseConfigEditorText,
  resetScopeConfig,
  type ConfigScope,
  writeScopeConfig,
} from "../src/config.ts";
import { formatFileOperations, mergeFileLists, parseFileLists, stripFileTags } from "../src/file-tags.ts";
import { buildAutoCompactInstructions, decideAutoCompact } from "../src/policy.ts";
import { buildSummarizationPrompt, resolveSummaryMode, stripAutocompactDirectives } from "../src/prompt.ts";
import {
  createInitialState,
  formatStatusLine,
  formatStatusReport,
  noteCompactionCompleted,
  noteCompactionFailed,
  noteCompactionRequested,
  noteEvaluation,
  noteObservedTokens,
  type AutoCompactState,
  type StatusSnapshot,
} from "../src/state.ts";
import { estimateToolResultTokens } from "../src/tool-results.ts";

const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant. Read the provided conversation material and output only the requested structured summary. Do not continue the conversation.`;
const STATUS_KEY = "pi-autocompact-v2";
const STATUS_WIDGET_KEY = "pi-autocompact-v2-report";

type FileOps = {
  read: Set<string>;
  written: Set<string>;
  edited: Set<string>;
};

function computeFileLists(fileOps: FileOps): { readFiles: string[]; modifiedFiles: string[] } {
  const modifiedFiles = [...new Set([...fileOps.edited, ...fileOps.written])].sort();
  const modifiedSet = new Set(modifiedFiles);
  const readFiles = [...new Set(fileOps.read)].sort().filter((path) => !modifiedSet.has(path));
  return { readFiles, modifiedFiles };
}

function collectSummaryText(response: Awaited<ReturnType<typeof complete>>): string {
  return response.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

async function buildStatusSnapshot(ctx: ExtensionContext, state: AutoCompactState): Promise<StatusSnapshot> {
  const configInfo = await loadEffectiveConfig(ctx.cwd, ctx.isProjectTrusted());
  const usage = ctx.getContextUsage();
  const evaluation =
    usage?.tokens === null || usage?.tokens === undefined
      ? undefined
      : decideAutoCompact({
          config: configInfo.config,
          currentTokens: usage.tokens,
          previousTokens: state.previousTokens,
          contextWindow: usage.contextWindow,
          turnIndex: state.lastTriggerTurn ?? 0,
          consecutiveGrowthTurns: state.consecutiveGrowthTurns,
          compactInFlight: state.compactInFlight,
          lastTriggerTurn: state.lastTriggerTurn,
          toolResultTokens: 0,
          toolResultsCount: 0,
        });

  return {
    config: configInfo.config,
    configInfo,
    currentTokens: usage?.tokens ?? null,
    contextWindow: usage?.contextWindow ?? null,
    percent: usage?.percent ?? null,
    state,
    evaluation,
  };
}

function applyStatus(ctx: ExtensionContext, snapshot: StatusSnapshot): void {
  if (!snapshot.config.showStatus) {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    return;
  }
  ctx.ui.setStatus(STATUS_KEY, formatStatusLine(snapshot));
}

function setStatusReportWidget(ctx: ExtensionContext, report?: string): void {
  ctx.ui.setWidget(STATUS_WIDGET_KEY, report ? report.split("\n") : undefined, { placement: "belowEditor" });
}

function notify(ctx: ExtensionContext, message: string, type: "info" | "warning" | "error" = "info"): void {
  if (ctx.hasUI) ctx.ui.notify(message, type);
}

function debugNotify(ctx: ExtensionContext, enabled: boolean, message: string): void {
  if (enabled) notify(ctx, `Autocompact v2: ${message}`, "info");
}

function buildManualNowInstructions(args: string): string | undefined {
  const trimmed = args.trim();
  if (!trimmed) return buildAutoCompactInstructions("soft-threshold", "standard");
  return `${buildAutoCompactInstructions("soft-threshold", "standard")}\n\n${trimmed}`;
}

async function editConfig(scope: ConfigScope, ctx: ExtensionCommandContext): Promise<void> {
  const current = await loadScopeConfig(scope, ctx.cwd);
  const prefill = formatConfigEditorText(current.exists ? current.raw : DEFAULT_CONFIG);
  const edited = await ctx.ui.editor(`Edit ${scope} autocompact config`, prefill);
  if (edited === undefined) return;

  try {
    const parsed = parseConfigEditorText(edited);
    const filePath = await writeScopeConfig(scope, ctx.cwd, parsed);
    notify(ctx, `Autocompact v2 ${scope} config saved to ${filePath}`, "info");
  } catch (error) {
    notify(ctx, `Autocompact v2 config not saved: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
}

async function setGlobalEnabled(ctx: ExtensionCommandContext, enabled: boolean): Promise<void> {
  const current = await loadScopeConfig("global", ctx.cwd);
  const next = { ...current.raw, enabled };
  const filePath = await writeScopeConfig("global", ctx.cwd, next);
  notify(ctx, `Autocompact v2 ${enabled ? "enabled" : "disabled"} via ${filePath}`, "info");
}

async function setScopeConfigValue(ctx: ExtensionCommandContext, scope: ConfigScope, key: string, rawValue: string): Promise<void> {
  const current = await loadScopeConfig(scope, ctx.cwd);
  if (!(key in DEFAULT_CONFIG)) {
    notify(ctx, `Unknown autocompact setting: ${key}`, "error");
    return;
  }

  const coerced = coerceRawConfigValue(key as keyof typeof DEFAULT_CONFIG, rawValue);
  if (coerced === undefined) {
    notify(ctx, `Invalid value for ${key}: ${rawValue}`, "error");
    return;
  }

  const next = { ...current.raw, [key]: coerced };
  const filePath = await writeScopeConfig(scope, ctx.cwd, next);
  notify(ctx, `Autocompact v2 updated ${key} in ${filePath}`, "info");
}

async function showStatus(ctx: ExtensionCommandContext, state: AutoCompactState): Promise<void> {
  const snapshot = await buildStatusSnapshot(ctx, state);
  applyStatus(ctx, snapshot);
  const report = formatStatusReport(snapshot);
  setStatusReportWidget(ctx, report);
  notify(ctx, `Autocompact v2 status refreshed: ${formatStatusLine(snapshot)}`, "info");
}

function registerCommands(pi: ExtensionAPI, state: AutoCompactState): void {
  pi.registerCommand("autocompact-status", {
    description: "Show autocompact v2 status in a widget",
    handler: async (args, ctx) => {
      if (args.trim() === "clear") {
        setStatusReportWidget(ctx);
        notify(ctx, "Autocompact v2 status widget cleared.", "info");
        return;
      }
      await showStatus(ctx, state);
    },
  });

  pi.registerCommand("autocompact-on", {
    description: "Enable proactive autocompact globally",
    handler: async (_args, ctx) => {
      await setGlobalEnabled(ctx, true);
      await showStatus(ctx, state);
    },
  });

  pi.registerCommand("autocompact-off", {
    description: "Disable proactive autocompact globally",
    handler: async (_args, ctx) => {
      await setGlobalEnabled(ctx, false);
      await showStatus(ctx, state);
    },
  });

  pi.registerCommand("autocompact-now", {
    description: "Trigger compaction immediately with optional extra instructions",
    handler: async (args, ctx) => {
      if (state.compactInFlight) {
        notify(ctx, "Autocompact v2 already has a compaction in flight.", "warning");
        return;
      }
      const instructions = buildManualNowInstructions(args);
      state.compactInFlight = true;
      state.lastCompactionReason = "manual-now";
      ctx.compact({
        customInstructions: instructions,
        onComplete: () => {
          state.compactInFlight = false;
        },
        onError: () => {
          noteCompactionFailed(state);
        },
      });
      notify(ctx, "Autocompact v2 requested an immediate compaction.", "info");
    },
  });

  pi.registerCommand("autocompact-config", {
    description: "Edit, reset, or tweak autocompact v2 config",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      let scope: ConfigScope = "global";
      if (parts[0] === "global" || parts[0] === "project") {
        scope = parts.shift() as ConfigScope;
      }

      const action = parts[0];
      if (!action) {
        await editConfig(scope, ctx);
        await showStatus(ctx, state);
        return;
      }

      if (action === "reset") {
        const filePath = await resetScopeConfig(scope, ctx.cwd);
        notify(ctx, `Autocompact v2 ${scope} config reset at ${filePath}`, "info");
        await showStatus(ctx, state);
        return;
      }

      if (action === "path") {
        const scopeInfo = await loadScopeConfig(scope, ctx.cwd);
        notify(ctx, `Autocompact v2 ${scope} config path: ${scopeInfo.path}`, "info");
        return;
      }

      if (parts.length >= 2) {
        await setScopeConfigValue(ctx, scope, action, parts.slice(1).join(" "));
        await showStatus(ctx, state);
        return;
      }

      notify(ctx, "Usage: /autocompact-config [global|project] [reset|path|<key> <value>]", "warning");
    },
  });
}

export default function (pi: ExtensionAPI) {
  const state = createInitialState();
  registerCommands(pi, state);

  pi.on("session_start", async (_event, ctx) => {
    const snapshot = await buildStatusSnapshot(ctx, state);
    applyStatus(ctx, snapshot);
    debugNotify(ctx, snapshot.config.debug, `loaded (${formatConfigSummary(snapshot.config)})`);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    setStatusReportWidget(ctx);
  });

  pi.on("session_compact", async (event, ctx) => {
    const source = event.fromExtension ? "extension" : "core";
    const completedReason = event.fromExtension && state.lastCompactionReason ? state.lastCompactionReason : event.reason;
    noteCompactionCompleted(state, state.lastTriggerTurn, source, completedReason);
    const snapshot = await buildStatusSnapshot(ctx, state);
    applyStatus(ctx, snapshot);
    debugNotify(ctx, snapshot.config.debug, `compaction completed via ${source} (${event.reason})`);
  });

  pi.on("turn_end", async (event, ctx) => {
    const usage = ctx.getContextUsage();
    if (!usage || usage.tokens === null) return;

    const configInfo = await loadEffectiveConfig(ctx.cwd, ctx.isProjectTrusted());
    const evaluation = decideAutoCompact({
      config: configInfo.config,
      currentTokens: usage.tokens,
      previousTokens: state.previousTokens,
      contextWindow: usage.contextWindow,
      turnIndex: event.turnIndex,
      consecutiveGrowthTurns: state.consecutiveGrowthTurns,
      compactInFlight: state.compactInFlight,
      lastTriggerTurn: state.lastTriggerTurn,
      toolResultTokens: estimateToolResultTokens(event.toolResults),
      toolResultsCount: event.toolResults.length,
    });

    noteEvaluation(state, evaluation);
    noteObservedTokens(state, usage.tokens);

    const snapshot: StatusSnapshot = {
      config: configInfo.config,
      configInfo,
      currentTokens: usage.tokens,
      contextWindow: usage.contextWindow,
      percent: usage.percent,
      state,
      evaluation,
    };
    applyStatus(ctx, snapshot);

    if (configInfo.warnings.length > 0) {
      debugNotify(ctx, configInfo.config.debug, configInfo.warnings.join(" | "));
    }

    if (!evaluation.decision.compact) {
      debugNotify(ctx, configInfo.config.debug, `no compact (${evaluation.decision.reason}) at turn ${event.turnIndex}`);
      return;
    }

    noteCompactionRequested(state, event.turnIndex, evaluation.decision.reason);
    notify(
      ctx,
      `Autocompact v2: ${evaluation.decision.reason} at ${usage.tokens.toLocaleString()} tokens; compacting now.`,
      "info",
    );

    ctx.compact({
      customInstructions: evaluation.decision.customInstructions,
      onComplete: () => {
        state.compactInFlight = false;
      },
      onError: (error) => {
        noteCompactionFailed(state);
        notify(ctx, `Autocompact v2 trigger failed: ${error.message}`, "error");
      },
    });
  });

  pi.on("session_before_compact", async (event, ctx) => {
    const { preparation, signal, customInstructions } = event;
    const {
      messagesToSummarize,
      turnPrefixMessages,
      firstKeptEntryId,
      tokensBefore,
      previousSummary,
      fileOps,
      settings,
    } = preparation;


    const summaryReason =
      state.lastCompactionReason === "manual-now"
        ? "manual"
        : state.lastCompactionReason === "emergency-near-limit"
          ? "overflow"
          : "threshold";
    const willRetry = false;

    const model = ctx.model;
    if (!model) {
      notify(ctx, "Autocompact v2: no active model; falling back to default compaction.", "warning");
      return;
    }

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) {
      notify(ctx, `Autocompact v2: could not resolve auth for ${model.provider}/${model.id}; using default compaction.`, "warning");
      return;
    }

    const allMessages = [...messagesToSummarize, ...turnPrefixMessages];
    if (allMessages.length === 0) return;

    const mode = resolveSummaryMode({ reason: summaryReason, willRetry, customInstructions });
    const promptText = [
      `<conversation>\n${serializeConversation(convertToLlm(allMessages))}\n</conversation>`,
      previousSummary ? `<previous-summary>\n${previousSummary}\n</previous-summary>` : "",
      `<compaction-context>\nreason=${summaryReason}\nmode=${mode}\nsplitTurn=${String(turnPrefixMessages.length > 0)}\ntrigger=${state.lastCompactionReason ?? "unknown"}\n</compaction-context>`,
      buildSummarizationPrompt({
        mode,
        previousSummary: Boolean(previousSummary),
        customInstructions: stripAutocompactDirectives(customInstructions),
        hasSplitTurn: turnPrefixMessages.length > 0,
      }),
    ]
      .filter(Boolean)
      .join("\n\n");

    const maxTokens = Math.min(
      Math.floor(0.8 * settings.reserveTokens),
      model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
    );

    try {
      notify(ctx, `Autocompact v2: summarizing ${allMessages.length} messages with ${model.provider}/${model.id}.`, "info");

      const response = await complete(
        model,
        {
          systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: promptText }],
              timestamp: Date.now(),
            },
          ],
        },
        {
          apiKey: auth.apiKey,
          headers: auth.headers,
          env: auth.env,
          maxTokens,
          signal,
        },
      );

      let summary = collectSummaryText(response);
      if (!summary) {
        notify(ctx, "Autocompact v2 produced an empty summary; using default compaction.", "warning");
        return;
      }

      summary = stripFileTags(summary);
      const previousFiles = parseFileLists(previousSummary);
      const currentFiles = computeFileLists(fileOps as FileOps);
      const mergedFiles = mergeFileLists(previousFiles, currentFiles);
      summary += formatFileOperations(mergedFiles.readFiles, mergedFiles.modifiedFiles);


      return {
        compaction: {
          summary,
          firstKeptEntryId,
          tokensBefore,
          details: mergedFiles,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!signal.aborted) notify(ctx, `Autocompact v2 failed: ${message}`, "error");
      return;
    }
  });
}
