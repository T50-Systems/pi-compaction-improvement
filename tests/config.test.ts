import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, formatConfigSummary, normalizeConfig, parseConfigEditorText } from "../src/config.ts";

describe("normalizeConfig", () => {
  it("fills defaults and clamps invalid values", () => {
    const config = normalizeConfig({
      enabled: "false",
      reserveTokens: "1000",
      softBufferTokens: 500,
      emergencyBufferTokens: 900,
      rapidGrowthMinPercent: 500,
      sustainedGrowthTurns: 0,
    });
    expect(config.enabled).toBe(false);
    expect(config.reserveTokens).toBe(1024);
    expect(config.softBufferTokens).toBe(900);
    expect(config.rapidGrowthMinPercent).toBe(100);
    expect(config.sustainedGrowthTurns).toBe(1);
    expect(config.persistLifecycleDiagnostics).toBe(false);
  });

  it("matches defaults when empty", () => {
    expect(normalizeConfig({})).toEqual(DEFAULT_CONFIG);
  });

  it("requires an explicit persistence opt-in", () => {
    expect(DEFAULT_CONFIG.persistLifecycleDiagnostics).toBe(false);
    expect(normalizeConfig({ persistLifecycleDiagnostics: "on" }).persistLifecycleDiagnostics).toBe(true);
    expect(normalizeConfig({ persistLifecycleDiagnostics: "invalid" }).persistLifecycleDiagnostics).toBe(false);
  });
});

describe("config helpers", () => {
  it("parses editor JSON objects", () => {
    expect(parseConfigEditorText('{"enabled":false}')).toEqual({ enabled: false });
  });

  it("rejects non-object JSON", () => {
    expect(() => parseConfigEditorText("[]")).toThrow(/JSON object/i);
  });

  it("formats a concise summary", () => {
    expect(formatConfigSummary(DEFAULT_CONFIG)).toContain("enabled=true");
    expect(formatConfigSummary(DEFAULT_CONFIG)).toContain("diagnosticPersistence=false");
  });
});
