import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolContext } from "./types.js";

const ctx = {} as ToolContext;

beforeEach(() => {
  vi.resetModules();
  vi.doMock("../env.js", () => ({
    env: { COOLIFY_BASE_URL: undefined, COOLIFY_ACCESS_TOKEN: undefined },
  }));
});

describe("coolify HTTP tools — env not configured", () => {
  it("setCoolifyComposeLocationTool returns env-not-configured error", async () => {
    const { setCoolifyComposeLocationTool } = await import("./coolifySetComposeLocation.js");
    const out = await setCoolifyComposeLocationTool.execute(
      { applicationUuid: "u", dockerComposeLocation: "/c.yml" },
      ctx,
    );
    expect(JSON.parse(out)).toEqual({ error: "Coolify env not configured" });
  });

  it("setCoolifyGitBranchTool returns env-not-configured error", async () => {
    const { setCoolifyGitBranchTool } = await import("./coolifySetGitBranch.js");
    const out = await setCoolifyGitBranchTool.execute(
      { applicationUuid: "u", gitBranch: "main" },
      ctx,
    );
    expect(JSON.parse(out)).toEqual({ error: "Coolify env not configured" });
  });

  it("waitForDeploymentTool returns env-not-configured error", async () => {
    const { waitForDeploymentTool } = await import("./coolifyWaitForDeployment.js");
    const out = await waitForDeploymentTool.execute(
      { deploymentUuid: "d", applicationUuid: "a" },
      ctx,
    );
    expect(JSON.parse(out)).toEqual({ error: "Coolify env not configured" });
  });
});
