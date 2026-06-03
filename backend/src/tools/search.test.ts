import { describe, it, expect, vi, afterEach } from "vitest";
import { searchTool } from "./search.js";

function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const fn = vi.fn(impl as any);
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchTool", () => {
  it("returns mapped results from the Brave API", async () => {
    const fetchMock = mockFetch(async () =>
      new Response(
        JSON.stringify({
          web: {
            results: [
              { title: "T1", url: "u1", description: "d1" },
              { title: "T2", url: "u2", description: "d2" },
            ],
          },
        }),
        { status: 200 },
      ),
    );

    const out = await searchTool.execute({ query: "fastify" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("q=fastify");
    expect(url).toContain("count=5");
    expect((init.headers as Record<string, string>)["X-Subscription-Token"]).toBe("brave-test");
    expect(JSON.parse(out).results).toEqual([
      { title: "T1", url: "u1", snippet: "d1" },
      { title: "T2", url: "u2", snippet: "d2" },
    ]);
  });

  it("clamps count to [1,10]", async () => {
    const fetchMock = mockFetch(async () => new Response('{"web":{"results":[]}}'));

    await searchTool.execute({ query: "q", count: 99 });
    expect(fetchMock.mock.calls[0][0]).toContain("count=10");

    await searchTool.execute({ query: "q", count: 0 });
    expect(fetchMock.mock.calls[1][0]).toContain("count=1");
  });

  it("returns an HTTP error on non-2xx", async () => {
    mockFetch(async () => new Response("err", { status: 503 }));
    const out = await searchTool.execute({ query: "q" });
    expect(JSON.parse(out)).toEqual({ error: "search failed: 503" });
  });

  it("returns empty results when payload has no web results", async () => {
    mockFetch(async () => new Response("{}", { status: 200 }));
    const out = await searchTool.execute({ query: "q" });
    expect(JSON.parse(out)).toEqual({ results: [] });
  });
});
