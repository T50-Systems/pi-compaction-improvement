import { describe, expect, it } from "vitest";
import { buildSummarizationPrompt, resolveSummaryMode, stripAutocompactDirectives } from "../src/prompt.ts";

describe("resolveSummaryMode", () => {
  it("uses aggressive mode for overflow recovery", () => {
    expect(resolveSummaryMode({ reason: "overflow", willRetry: true })).toBe("aggressive");
  });

  it("uses focused mode when custom instructions are present", () => {
    expect(resolveSummaryMode({ reason: "manual", willRetry: false, customInstructions: "Focus on auth." })).toBe("focused");
  });

  it("defaults to standard otherwise", () => {
    expect(resolveSummaryMode({ reason: "threshold", willRetry: false })).toBe("standard");
  });

  it("respects forced aggressive mode markers", () => {
    expect(resolveSummaryMode({ reason: "manual", willRetry: false, customInstructions: "[AUTOCOMPACT_MODE=aggressive]\nFocus on errors." })).toBe("aggressive");
  });
});

describe("buildSummarizationPrompt", () => {
  it("includes the new operational sections", () => {
    const prompt = buildSummarizationPrompt({ mode: "standard", previousSummary: false, hasSplitTurn: false });
    expect(prompt).toContain("## Discarded Hypotheses");
    expect(prompt).toContain("## Risks");
    expect(prompt).toContain("## Immediate Next Action");
    expect(prompt).toContain("## Continuation Contract");
    expect(prompt).toContain("Resume automatically after compaction");
  });

  it("adds split-turn guidance when needed", () => {
    const prompt = buildSummarizationPrompt({ mode: "standard", previousSummary: false, hasSplitTurn: true });
    expect(prompt).toContain("retained outside this summary");
  });

  it("adds custom focus guidance in focused mode", () => {
    const prompt = buildSummarizationPrompt({ mode: "focused", previousSummary: true, customInstructions: "Focus on deploy blockers.", hasSplitTurn: false });
    expect(prompt).toContain("Additional focus: Focus on deploy blockers.");
    expect(prompt).toContain("Update the existing structured summary");
  });

  it("instructs summaries to preserve automatic continuation", () => {
    const prompt = buildSummarizationPrompt({ mode: "standard", previousSummary: false, hasSplitTurn: false });
    expect(prompt).toContain("Continuation Contract must say whether the agent should resume automatically after compaction.");
    expect(prompt).toContain("Set Resume automatically to yes unless progress is blocked");
    expect(prompt).toContain("executable instruction, not a question or status recap");
  });

  it("strips autocompact directives before showing custom focus", () => {
    expect(stripAutocompactDirectives("[AUTOCOMPACT_MODE=aggressive]\n[AUTOCOMPACT_REASON=rapid-growth]\nFocus on deploy blockers.")).toBe("Focus on deploy blockers.");
  });
});
