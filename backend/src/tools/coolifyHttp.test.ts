import { describe, it, expect, vi, afterEach } from "vitest";
import { setCoolifyComposeLocationTool } from "./coolifySetComposeLocation.js";
import { setCoolifyGitBranchTool } from "./coolifySetGitBranch.js";
import type { ToolContext } from "./types.js";

const ctx = {} as ToolContext;

function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const fn = vi.fn(impl as any);
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("setCoolifyComposeLocationTool", () => {
  it("requires applicationUuid", async () => {
    const out = await setCoolifyComposeLocationTool.execute(
      { dockerComposeLocation: "/c.yml" } as any,
      ctx,
    );
    expect(JSON.parse(out)).toEqual({ error: "applicationUuid required" });
  });

  it("requires dockerComposeLocation", async () => {
    const out = await setCoolifyComposeLocationTool.execute(
      { applicationUuid: "u" } as any,
      ctx,
    );
    expect(JSON.parse(out)).toEqual({ error: "dockerComposeLocation required" });
  });

  it("PATCHes the application and returns parsed result on success", async () => {
    const fetchMock = mockFetch(async () =>
      new Response(JSON.stringify({ ok: 1 }), { status: 200 }),
    );

    const out = await setCoolifyComposeLocationTool.execute(
      { applicationUuid: "uuid-1", dockerComposeLocation: "/c.yml" },
      ctx,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe("https://coolify.test/api/v1/applications/uuid-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ docker_compose_location: "/c.yml" });

    expect(JSON.parse(out)).toEqual({
      status: "ok",
      dockerComposeLocation: "/c.yml",
      result: { ok: 1 },
    });
  });

  it("falls back to raw text when the response is not JSON", async () => {
    mockFetch(async () => new Response("not-json", { status: 200 }));
    const out = await setCoolifyComposeLocationTool.execute(
      { applicationUuid: "u", dockerComposeLocation: "/c.yml" },
      ctx,
    );
    expect(JSON.parse(out)).toMatchObject({ result: "not-json" });
  });

  it("returns HTTP error with body slice on non-2xx", async () => {
    mockFetch(async () => new Response("nope", { status: 500 }));
    const out = await setCoolifyComposeLocationTool.execute(
      { applicationUuid: "u", dockerComposeLocation: "/c.yml" },
      ctx,
    );
    expect(JSON.parse(out)).toEqual({ error: "HTTP 500", body: "nope" });
  });

  it("returns the thrown error message when fetch throws", async () => {
    mockFetch(async () => {
      throw new Error("network down");
    });
    const out = await setCoolifyComposeLocationTool.execute(
      { applicationUuid: "u", dockerComposeLocation: "/c.yml" },
      ctx,
    );
    expect(JSON.parse(out).error).toContain("network down");
  });
});

describe("setCoolifyGitBranchTool", () => {
  it("PATCHes git_branch on success", async () => {
    const fetchMock = mockFetch(async () =>
      new Response(JSON.stringify({ ok: 1 }), { status: 200 }),
    );

    const out = await setCoolifyGitBranchTool.execute(
      { applicationUuid: "uuid-1", gitBranch: "main" },
      ctx,
    );

    const init = fetchMock.mock.calls[0][1];
    expect(JSON.parse(init.body as string)).toEqual({ git_branch: "main" });
    expect(JSON.parse(out)).toMatchObject({ status: "ok", gitBranch: "main" });
  });

  it("requires applicationUuid and gitBranch", async () => {
    expect(
      JSON.parse(await setCoolifyGitBranchTool.execute({ gitBranch: "main" } as any, ctx)),
    ).toEqual({ error: "applicationUuid required" });
    expect(
      JSON.parse(await setCoolifyGitBranchTool.execute({ applicationUuid: "u" } as any, ctx)),
    ).toEqual({ error: "gitBranch required" });
  });

  it("surfaces HTTP errors and fetch exceptions", async () => {
    mockFetch(async () => new Response("err", { status: 400 }));
    expect(
      JSON.parse(
        await setCoolifyGitBranchTool.execute(
          { applicationUuid: "u", gitBranch: "main" },
          ctx,
        ),
      ),
    ).toEqual({ error: "HTTP 400", body: "err" });

    mockFetch(async () => {
      throw new Error("boom");
    });
    expect(
      JSON.parse(
        await setCoolifyGitBranchTool.execute(
          { applicationUuid: "u", gitBranch: "main" },
          ctx,
        ),
      ).error,
    ).toContain("boom");
  });
});
