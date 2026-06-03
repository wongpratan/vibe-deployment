import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolContext } from "./types.js";

const { findLatestCollected, callCoolifyToolByOriginalName } = vi.hoisted(() => ({
  findLatestCollected: vi.fn(),
  callCoolifyToolByOriginalName: vi.fn(),
}));

vi.mock("../chat/coordinator.repository.js", () => ({
  coordinatorRepository: { findLatestCollected },
}));
vi.mock("../mcp/coolifyClient.js", () => ({
  callCoolifyToolByOriginalName,
}));

const ctx: ToolContext = { chatId: "c1", userId: "u1" } as unknown as ToolContext;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("setCoolifyEnvVarsTool", () => {
  it("requires applicationUuid", async () => {
    const { setCoolifyEnvVarsTool } = await import("./coolifySetEnvVars.js");
    const out = await setCoolifyEnvVarsTool.execute({}, ctx);
    expect(JSON.parse(out)).toEqual({ error: "applicationUuid required" });
  });

  it("returns error when no coordinator requirements row exists", async () => {
    findLatestCollected.mockResolvedValueOnce(null);
    const { setCoolifyEnvVarsTool } = await import("./coolifySetEnvVars.js");
    const out = await setCoolifyEnvVarsTool.execute({ applicationUuid: "u" }, ctx);
    expect(JSON.parse(out)).toEqual({
      error: "no coordinator requirements found for this chat",
    });
  });

  it("skips when env vars list is empty after filtering", async () => {
    findLatestCollected.mockResolvedValueOnce({
      envVars: [{ value: "no-key" }, { key: "" }],
    });
    const { setCoolifyEnvVarsTool } = await import("./coolifySetEnvVars.js");
    const out = await setCoolifyEnvVarsTool.execute({ applicationUuid: "u" }, ctx);
    expect(JSON.parse(out)).toEqual({ status: "skipped", reason: "no env vars to set" });
  });

  it("calls the MCP bulk_update tool with the collected env vars", async () => {
    findLatestCollected.mockResolvedValueOnce({
      envVars: [
        { key: "API_KEY", value: "secret" },
        { key: "EMPTY_VAL" },
      ],
    });
    callCoolifyToolByOriginalName.mockResolvedValueOnce('{"updated":2}');
    const { setCoolifyEnvVarsTool } = await import("./coolifySetEnvVars.js");

    const out = await setCoolifyEnvVarsTool.execute({ applicationUuid: "app-1" }, ctx);

    expect(callCoolifyToolByOriginalName).toHaveBeenCalledWith("env_vars", {
      resource: "application",
      action: "bulk_update",
      uuid: "app-1",
      data: [
        { key: "API_KEY", value: "secret" },
        { key: "EMPTY_VAL", value: "" },
      ],
    });
    expect(JSON.parse(out)).toEqual({ status: "ok", count: 2, result: { updated: 2 } });
  });

  it("returns the thrown error message when the MCP call throws", async () => {
    findLatestCollected.mockResolvedValueOnce({
      envVars: [{ key: "K", value: "v" }],
    });
    callCoolifyToolByOriginalName.mockRejectedValueOnce(new Error("mcp down"));
    const { setCoolifyEnvVarsTool } = await import("./coolifySetEnvVars.js");

    const out = await setCoolifyEnvVarsTool.execute({ applicationUuid: "u" }, ctx);

    expect(JSON.parse(out).error).toContain("mcp down");
  });

  it("treats non-array envVars as empty", async () => {
    findLatestCollected.mockResolvedValueOnce({ envVars: "not-an-array" });
    const { setCoolifyEnvVarsTool } = await import("./coolifySetEnvVars.js");
    const out = await setCoolifyEnvVarsTool.execute({ applicationUuid: "u" }, ctx);
    expect(JSON.parse(out)).toEqual({ status: "skipped", reason: "no env vars to set" });
  });
});
