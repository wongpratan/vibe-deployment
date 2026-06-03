import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolContext } from "./types.js";

vi.mock("../mcp/coolifyClient.js", () => ({
  getCoolifyTools: vi.fn(async () => [
    {
      type: "function",
      function: { name: "coolify_deploy", description: "", parameters: {} },
    },
  ]),
  dispatchCoolifyTool: vi.fn(async (name: string, args: string) =>
    JSON.stringify({ name, args }),
  ),
  isCoolifyToolName: (name: string) => name.startsWith("coolify_"),
}));

vi.mock("./review.js", () => ({
  saveReviewResultTool: {
    schema: { type: "function", function: { name: "save_review_result", description: "", parameters: {} } },
    execute: vi.fn(async () => '{"saved":true}'),
  },
}));

vi.mock("./coordinator.js", () => ({
  saveCoordinatorRequirementsTool: {
    schema: { type: "function", function: { name: "save_coordinator_requirements", description: "", parameters: {} } },
    execute: vi.fn(async () => '{"saved":true}'),
  },
}));

vi.mock("./cloneRepo.js", () => ({
  cloneAndInspectRepoTool: {
    schema: { type: "function", function: { name: "clone_and_inspect_repo", description: "", parameters: {} } },
    execute: vi.fn(async () => "{}"),
  },
}));

vi.mock("./coolifySetEnvVars.js", () => ({
  setCoolifyEnvVarsTool: {
    schema: { type: "function", function: { name: "set_coolify_env_vars", description: "", parameters: {} } },
    execute: vi.fn(async () => "{}"),
  },
}));

vi.mock("./coolifySetComposeLocation.js", () => ({
  setCoolifyComposeLocationTool: {
    schema: { type: "function", function: { name: "set_coolify_compose_location", description: "", parameters: {} } },
    execute: vi.fn(async () => "{}"),
  },
}));

vi.mock("./coolifySetGitBranch.js", () => ({
  setCoolifyGitBranchTool: {
    schema: { type: "function", function: { name: "set_coolify_git_branch", description: "", parameters: {} } },
    execute: vi.fn(async () => "{}"),
  },
}));

vi.mock("./coolifyWaitForDeployment.js", () => ({
  waitForDeploymentTool: {
    schema: { type: "function", function: { name: "wait_for_deployment", description: "", parameters: {} } },
    execute: vi.fn(async () => "{}"),
  },
}));

vi.mock("./search.js", () => ({
  searchTool: {
    schema: { type: "function", function: { name: "web_search", description: "", parameters: {} } },
    execute: vi.fn(async () => '{"results":[]}'),
  },
}));

const ctx: ToolContext = { userId: "u1", chatId: "c1" } as unknown as ToolContext;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getToolsForAgent — schemas", () => {
  it("exposes reviewer's local tools and no coolify tools", async () => {
    const { getToolsForAgent } = await import("./index.js");
    const { schemas } = await getToolsForAgent("reviewer");

    const names = schemas.map((s) => s.function.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "clone_and_inspect_repo",
        "detect_build_pack",
        "web_search",
        "save_review_result",
        "request_user_input",
      ]),
    );
    expect(names).not.toContain("coolify_deploy");
  });

  it("includes coolify tools only for the deployer agent", async () => {
    const { getToolsForAgent } = await import("./index.js");
    const { schemas } = await getToolsForAgent("deployer");

    expect(schemas.map((s) => s.function.name)).toContain("coolify_deploy");
  });
});

describe("dispatch — local tools", () => {
  it("invokes the matching tool with parsed args", async () => {
    const { getToolsForAgent } = await import("./index.js");
    const { saveReviewResultTool } = await import("./review.js");
    const { dispatch } = await getToolsForAgent("reviewer");

    const out = await dispatch("save_review_result", '{"ready":true}', ctx);

    expect(out).toBe('{"saved":true}');
    expect(saveReviewResultTool.execute).toHaveBeenCalledWith({ ready: true }, ctx);
  });

  it("returns an empty-args object when rawArgs is empty", async () => {
    const { getToolsForAgent } = await import("./index.js");
    const { saveReviewResultTool } = await import("./review.js");
    const { dispatch } = await getToolsForAgent("reviewer");

    await dispatch("save_review_result", "", ctx);

    expect(saveReviewResultTool.execute).toHaveBeenCalledWith({}, ctx);
  });

  it("returns an error when args are invalid JSON", async () => {
    const { getToolsForAgent } = await import("./index.js");
    const { dispatch } = await getToolsForAgent("reviewer");

    const out = await dispatch("save_review_result", "not-json", ctx);

    expect(JSON.parse(out)).toEqual({ error: "invalid JSON arguments" });
  });

  it("returns an error when the tool is not allowed for this agent", async () => {
    const { getToolsForAgent } = await import("./index.js");
    const { dispatch } = await getToolsForAgent("reviewer");

    const out = await dispatch("save_coordinator_requirements", "{}", ctx);

    expect(JSON.parse(out)).toEqual({
      error: "tool save_coordinator_requirements not allowed for agent reviewer",
    });
  });

  it("wraps thrown errors as a JSON error string", async () => {
    const { getToolsForAgent } = await import("./index.js");
    const { saveReviewResultTool } = await import("./review.js");
    (saveReviewResultTool.execute as any).mockRejectedValueOnce(new Error("boom"));
    const { dispatch } = await getToolsForAgent("reviewer");

    const out = await dispatch("save_review_result", "{}", ctx);

    expect(JSON.parse(out).error).toContain("boom");
  });
});

describe("dispatch — coolify tools", () => {
  it("routes coolify_ names through the MCP dispatcher for the deployer", async () => {
    const mcp = await import("../mcp/coolifyClient.js");
    const { getToolsForAgent } = await import("./index.js");
    const { dispatch } = await getToolsForAgent("deployer");

    const out = await dispatch("coolify_deploy", '{"tag_or_uuid":"x"}', ctx);

    expect(mcp.dispatchCoolifyTool).toHaveBeenCalledWith("coolify_deploy", '{"tag_or_uuid":"x"}');
    expect(JSON.parse(out)).toEqual({ name: "coolify_deploy", args: '{"tag_or_uuid":"x"}' });
  });

  it("denies coolify tools for non-deployer agents", async () => {
    const { getToolsForAgent } = await import("./index.js");
    const { dispatch } = await getToolsForAgent("reviewer");

    const out = await dispatch("coolify_deploy", "{}", ctx);

    expect(JSON.parse(out)).toEqual({
      error: "tool coolify_deploy not allowed for agent reviewer",
    });
  });
});
