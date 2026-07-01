import { describe, expect, it } from "vitest";
import { estimateToolResultTokens } from "../src/tool-results.ts";

describe("estimateToolResultTokens", () => {
  it("estimates tokens from content and details", () => {
    const tokens = estimateToolResultTokens([
      {
        content: [{ type: "text", text: "a".repeat(4000) }],
        details: { files: ["a.ts", "b.ts"] },
      },
    ]);
    expect(tokens).toBeGreaterThan(1000);
  });
});
