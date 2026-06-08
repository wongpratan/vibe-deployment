import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolContext } from "./types.js";

const { returning, values, insert } = vi.hoisted(() => {
  const returning = vi.fn();
  const values = vi.fn(() => ({ returning }));
  const insert = vi.fn(() => ({ values }));
  return { returning, values, insert };
});

vi.mock("../db/client.js", () => ({
  db: { insert },
  schema: { coordinatorRequirements: { __table: "coordinator_requirements" } },
}));

const ctx: ToolContext = { chatId: "c1", userId: "u1" } as unknown as ToolContext;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveCoordinatorRequirementsTool", () => {
  it("trims appName, normalizes envVars to an array, and returns a saved summary", async () => {
    returning.mockResolvedValueOnce([
      {
        id: "co-1",
        appName: "acme-app",
        envVars: [{ key: "A", value: "1" }, { key: "B", value: "2" }],
        collected: true,
      },
    ]);

    const { saveCoordinatorRequirementsTool } = await import("./coordinator.js");
    const out = await saveCoordinatorRequirementsTool.execute(
      {
        appName: "  acme-app  ",
        envVars: [{ key: "A", value: "1" }, { key: "B", value: "2" }],
        collected: true,
      },
      ctx,
    );

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        chatId: "c1",
        appName: "acme-app",
        envVars: [{ key: "A", value: "1" }, { key: "B", value: "2" }],
        collected: true,
      }),
    );
    expect(JSON.parse(out)).toEqual({
      status: "saved",
      id: "co-1",
      appName: "acme-app",
      envVarCount: 2,
      collected: true,
    });
  });

  it("treats non-array envVars input as an empty list", async () => {
    returning.mockResolvedValueOnce([
      { id: "co-2", appName: "x", envVars: "garbage", collected: false },
    ]);

    const { saveCoordinatorRequirementsTool } = await import("./coordinator.js");
    const out = await saveCoordinatorRequirementsTool.execute(
      { appName: "x", envVars: "not-an-array" as any, collected: false },
      ctx,
    );

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ envVars: [] }));
    expect(JSON.parse(out).envVarCount).toBe(0);
  });

  it("coerces collected falsy values to boolean false", async () => {
    returning.mockResolvedValueOnce([
      { id: "co-3", appName: "", envVars: [], collected: false },
    ]);

    const { saveCoordinatorRequirementsTool } = await import("./coordinator.js");
    await saveCoordinatorRequirementsTool.execute(
      { appName: undefined, envVars: [], collected: undefined },
      ctx,
    );

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ appName: "", collected: false }),
    );
  });
});
