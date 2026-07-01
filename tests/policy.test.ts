import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { buildAutoCompactInstructions, decideAutoCompact } from "../src/policy.ts";

const baseInput = {
  config: DEFAULT_CONFIG,
  currentTokens: 0,
  previousTokens: null,
  contextWindow: 128_000,
  turnIndex: 10,
  consecutiveGrowthTurns: 0,
  compactInFlight: false,
  lastTriggerTurn: null,
  toolResultTokens: 0,
  toolResultsCount: 0,
};

describe("decideAutoCompact", () => {
  it("triggers at the proactive soft threshold", () => {
    const evaluation = decideAutoCompact({ ...baseInput, currentTokens: 104_000 });
    expect(evaluation.decision).toMatchObject({ compact: true, reason: "soft-threshold", mode: "standard" });
  });

  it("triggers on rapid growth once above the floor", () => {
    const evaluation = decideAutoCompact({
      ...baseInput,
      currentTokens: 70_000,
      previousTokens: 62_000,
    });
    expect(evaluation.decision).toMatchObject({ compact: true, reason: "rapid-growth", mode: "aggressive" });
  });

  it("triggers on sustained growth after the configured streak", () => {
    const evaluation = decideAutoCompact({
      ...baseInput,
      currentTokens: 82_000,
      previousTokens: 80_000,
      consecutiveGrowthTurns: 2,
    });
    expect(evaluation.decision).toMatchObject({ compact: true, reason: "sustained-growth" });
  });

  it("triggers on tool-heavy turns", () => {
    const evaluation = decideAutoCompact({
      ...baseInput,
      currentTokens: 78_000,
      toolResultTokens: 9_000,
      toolResultsCount: 3,
    });
    expect(evaluation.decision).toMatchObject({ compact: true, reason: "tool-heavy-turn", mode: "aggressive" });
  });

  it("uses the emergency band even during cooldown", () => {
    const evaluation = decideAutoCompact({
      ...baseInput,
      currentTokens: 111_000,
      lastTriggerTurn: 9,
      previousTokens: 109_000,
    });
    expect(evaluation.decision).toMatchObject({ compact: true, reason: "emergency-near-limit", bypassCooldown: true });
  });

  it("suppresses non-emergency triggers during cooldown", () => {
    const evaluation = decideAutoCompact({
      ...baseInput,
      currentTokens: 104_000,
      lastTriggerTurn: 9,
    });
    expect(evaluation.decision).toMatchObject({ compact: false, reason: "cooldown" });
  });
});

describe("buildAutoCompactInstructions", () => {
  it("embeds machine-readable directives for the summarizer", () => {
    const instructions = buildAutoCompactInstructions("rapid-growth", "aggressive");
    expect(instructions).toContain("[AUTOCOMPACT_MODE=aggressive]");
    expect(instructions).toContain("[AUTOCOMPACT_REASON=rapid-growth]");
  });

  it("preserves continuation intent in trigger instructions", () => {
    const instructions = buildAutoCompactInstructions("tool-heavy-turn", "aggressive");
    expect(instructions).toContain("whether the agent should continue without asking the user");
  });
});
