import { describe, expect, it, vi } from "vitest";
import extension from "../extensions/index.ts";

describe("extension registration", () => {
  it("registers the proactive hooks and commands", () => {
    const on = vi.fn();
    const registerCommand = vi.fn();

    extension({ on, registerCommand } as never);

    expect(on).toHaveBeenCalledWith("agent_end", expect.any(Function));
    expect(on).toHaveBeenCalledWith("session_before_compact", expect.any(Function));
    expect(on).toHaveBeenCalledWith("session_compact", expect.any(Function));
    expect(registerCommand).toHaveBeenCalledWith("autocompact-status", expect.any(Object));
    expect(registerCommand).toHaveBeenCalledWith("autocompact-now", expect.any(Object));
    expect(registerCommand).toHaveBeenCalledWith("autocompact-config", expect.any(Object));
  });
});
