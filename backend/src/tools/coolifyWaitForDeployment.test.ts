import { describe, it, expect, vi, afterEach } from "vitest";
import { waitForDeploymentTool } from "./coolifyWaitForDeployment.js";
import type { ToolContext } from "./types.js";

const ctx = {} as ToolContext;

function mockFetchSeq(...impls: Array<(url: string) => Response>) {
  let i = 0;
  const fn = vi.fn(async (url: string) => impls[i++ % impls.length](url));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("waitForDeploymentTool — input validation", () => {
  it("requires deploymentUuid", async () => {
    const out = await waitForDeploymentTool.execute({ applicationUuid: "a" }, ctx);
    expect(JSON.parse(out)).toEqual({ error: "deploymentUuid required" });
  });

  it("requires applicationUuid", async () => {
    const out = await waitForDeploymentTool.execute({ deploymentUuid: "d" }, ctx);
    expect(JSON.parse(out)).toEqual({ error: "applicationUuid required" });
  });
});

describe("waitForDeploymentTool — terminal first poll", () => {
  it("returns finished + url when first poll is finished and fqdn is set", async () => {
    mockFetchSeq(
      () => new Response(JSON.stringify({ status: "finished" }), { status: 200 }),
      () => new Response(JSON.stringify({ fqdn: "myapp.example.com" }), { status: 200 }),
    );

    const out = await waitForDeploymentTool.execute(
      { deploymentUuid: "d", applicationUuid: "a" },
      ctx,
    );

    const parsed = JSON.parse(out);
    expect(parsed.status).toBe("finished");
    expect(parsed.url).toBe("https://myapp.example.com");
    expect(parsed.polls).toBe(1);
    expect(parsed.logsTail).toBeUndefined();
  });

  it("falls back to domains when fqdn is missing and prefers the first comma-separated entry", async () => {
    mockFetchSeq(
      () => new Response(JSON.stringify({ status: "finished" }), { status: 200 }),
      () => new Response(JSON.stringify({ domains: "https://a.example,https://b.example" }), { status: 200 }),
    );

    const out = await waitForDeploymentTool.execute(
      { deploymentUuid: "d", applicationUuid: "a" },
      ctx,
    );

    expect(JSON.parse(out).url).toBe("https://a.example");
  });

  it("returns finished + null url when application fetch fails", async () => {
    mockFetchSeq(
      () => new Response(JSON.stringify({ status: "finished" }), { status: 200 }),
      () => new Response("nope", { status: 500 }),
    );

    const out = await waitForDeploymentTool.execute(
      { deploymentUuid: "d", applicationUuid: "a" },
      ctx,
    );

    const parsed = JSON.parse(out);
    expect(parsed.status).toBe("finished");
    expect(parsed.url).toBeNull();
  });

  it("returns failed with logsTail when first poll is failed", async () => {
    mockFetchSeq(
      () =>
        new Response(
          JSON.stringify({
            status: "failed",
            logs: Array.from({ length: 80 }, (_, i) => `line${i}`).join("\n"),
          }),
          { status: 200 },
        ),
    );

    const out = await waitForDeploymentTool.execute(
      { deploymentUuid: "d", applicationUuid: "a" },
      ctx,
    );

    const parsed = JSON.parse(out);
    expect(parsed.status).toBe("failed");
    expect(parsed.url).toBeNull();
    expect(parsed.logsTail).toContain("line79");
    expect(parsed.logsTail).not.toContain("line29");
  });

  it("returns poll_error on non-JSON deployment response", async () => {
    mockFetchSeq(() => new Response("not-json", { status: 200 }));

    const out = await waitForDeploymentTool.execute(
      { deploymentUuid: "d", applicationUuid: "a" },
      ctx,
    );

    const parsed = JSON.parse(out);
    expect(parsed.status).toBe("poll_error");
    expect(parsed.error).toContain("non-JSON");
  });

  it("returns poll_error on HTTP error from deployment endpoint", async () => {
    mockFetchSeq(() => new Response("nope", { status: 500 }));

    const out = await waitForDeploymentTool.execute(
      { deploymentUuid: "d", applicationUuid: "a" },
      ctx,
    );

    const parsed = JSON.parse(out);
    expect(parsed.status).toBe("poll_error");
    expect(parsed.error).toContain("HTTP 500");
  });
});
