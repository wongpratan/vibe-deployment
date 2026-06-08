import { describe, it, expect, vi, afterEach } from "vitest";
import { waitForDeploymentTool } from "./coolifyWaitForDeployment.js";
import type { ToolContext } from "./types.js";

const ctx = {} as ToolContext;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("waitForDeploymentTool — polling loop", () => {
  it("advances past the 10s wait when first poll is in_progress and second is finished", async () => {
    vi.useFakeTimers();

    let call = 0;
    const fetchMock = vi.fn(async (url: string) => {
      call += 1;
      if (call === 1) return new Response(JSON.stringify({ status: "in_progress" }), { status: 200 });
      if (call === 2) return new Response(JSON.stringify({ status: "finished" }), { status: 200 });
      // application fetch
      return new Response(JSON.stringify({ fqdn: "app.example.com" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock as any);

    const promise = waitForDeploymentTool.execute(
      { deploymentUuid: "d", applicationUuid: "a" },
      ctx,
    );

    // First poll done synchronously; then a 10s wait before poll 2
    await vi.advanceTimersByTimeAsync(10_000);

    const out = await promise;
    const parsed = JSON.parse(out);
    expect(parsed.status).toBe("finished");
    expect(parsed.polls).toBe(2);
    expect(parsed.url).toBe("https://app.example.com");
  });

  it("returns status=timeout after MAX_POLLS non-terminal responses", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ status: "in_progress" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock as any);

    const promise = waitForDeploymentTool.execute(
      { deploymentUuid: "d", applicationUuid: "a" },
      ctx,
    );

    // 29 waits of 10s between 30 polls
    await vi.advanceTimersByTimeAsync(10_000 * 29);

    const out = await promise;
    const parsed = JSON.parse(out);
    expect(parsed.status).toBe("timeout");
    expect(parsed.polls).toBe(30);
    expect(parsed.url).toBeNull();
  });
});
