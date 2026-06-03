import { describe, it, expect } from "vitest";
import { cloneAndInspectRepoTool } from "./cloneRepo.js";
import type { ToolContext } from "./types.js";

const ctx = {} as ToolContext;

describe("cloneAndInspectRepoTool — repoUrl validation", () => {
  it("rejects non-string repoUrl", async () => {
    const out = await cloneAndInspectRepoTool.execute({ repoUrl: null }, ctx);
    expect(JSON.parse(out)).toEqual({
      clone_failed: true,
      reason: "repoUrl must be a non-empty string",
    });
  });

  it("rejects empty string", async () => {
    const out = await cloneAndInspectRepoTool.execute({ repoUrl: "" }, ctx);
    expect(JSON.parse(out)).toEqual({
      clone_failed: true,
      reason: "repoUrl must be a non-empty string",
    });
  });

  it("rejects an overly long URL", async () => {
    const out = await cloneAndInspectRepoTool.execute(
      { repoUrl: "https://github.com/x/" + "a".repeat(3000) },
      ctx,
    );
    expect(JSON.parse(out).reason).toBe("repoUrl too long");
  });

  it("rejects an unparseable URL", async () => {
    const out = await cloneAndInspectRepoTool.execute({ repoUrl: "::not a url" }, ctx);
    expect(JSON.parse(out).reason).toBe("repoUrl not a valid URL");
  });

  it("rejects non-http(s) protocols", async () => {
    const out = await cloneAndInspectRepoTool.execute(
      { repoUrl: "ftp://github.com/acme/app" },
      ctx,
    );
    expect(JSON.parse(out).reason).toContain("not allowed (https only)");
  });

  it.each([
    "http://localhost/acme/app",
    "http://127.0.0.1/acme/app",
    "http://10.0.0.1/acme/app",
    "http://192.168.1.1/acme/app",
    "http://172.16.0.1/acme/app",
    "http://169.254.0.1/acme/app",
  ])("rejects private/loopback host %s", async (url) => {
    const out = await cloneAndInspectRepoTool.execute({ repoUrl: url }, ctx);
    expect(JSON.parse(out).reason).toContain("private/loopback");
  });

  it("rejects hosts not in the allowlist", async () => {
    const out = await cloneAndInspectRepoTool.execute(
      { repoUrl: "https://evil.example.com/acme/app" },
      ctx,
    );
    expect(JSON.parse(out).reason).toContain("not in allowlist");
  });

  it("rejects URLs containing embedded credentials", async () => {
    const out = await cloneAndInspectRepoTool.execute(
      { repoUrl: "https://user:pw@github.com/acme/app" },
      ctx,
    );
    expect(JSON.parse(out).reason).toBe("embedded credentials not allowed in repoUrl");
  });
});
