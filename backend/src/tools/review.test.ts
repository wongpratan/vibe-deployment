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
  schema: { reviewResults: { __table: "review_results" } },
}));

const ctx: ToolContext = { chatId: "c1", userId: "u1" } as unknown as ToolContext;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveReviewResultTool — validation", () => {
  it("errors when buildPack=dockercompose but no dockerComposeLocation", async () => {
    const { saveReviewResultTool } = await import("./review.js");
    const out = await saveReviewResultTool.execute(
      { repoUrl: "x", ready: true, buildPack: "dockercompose" },
      ctx,
    );
    expect(JSON.parse(out)).toMatchObject({
      status: "error",
      reason: expect.stringContaining("dockerComposeLocation required"),
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("errors when buildPack=dockerfile but no dockerfileLocation", async () => {
    const { saveReviewResultTool } = await import("./review.js");
    const out = await saveReviewResultTool.execute(
      { repoUrl: "x", ready: true, buildPack: "dockerfile" },
      ctx,
    );
    expect(JSON.parse(out)).toMatchObject({
      status: "error",
      reason: expect.stringContaining("dockerfileLocation required"),
    });
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("saveReviewResultTool — persist", () => {
  it("inserts a row with all defaults applied and returns a saved summary", async () => {
    returning.mockResolvedValueOnce([
      {
        id: "r-1",
        ready: true,
        buildPack: "nixpacks",
        summary: "yes",
        nameGuess: "myapp",
        dockerComposeLocation: null,
        dockerfileLocation: null,
      },
    ]);

    const { saveReviewResultTool } = await import("./review.js");
    const out = await saveReviewResultTool.execute(
      {
        repoUrl: "https://github.com/acme/app",
        ready: true,
        buildPack: "nixpacks",
        summary: "yes",
        nameGuess: "myapp",
      },
      ctx,
    );

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        chatId: "c1",
        repoUrl: "https://github.com/acme/app",
        buildPack: "nixpacks",
        ready: true,
        issues: [],
        notes: null,
        summary: "yes",
        nameGuess: "myapp",
      }),
    );
    expect(JSON.parse(out)).toEqual({
      status: "saved",
      id: "r-1",
      ready: true,
      buildPack: "nixpacks",
      hasSummary: true,
      nameGuess: "myapp",
      dockerComposeLocation: null,
      dockerfileLocation: null,
    });
  });

  it("coerces ready to boolean and passes through compose/dockerfile locations", async () => {
    returning.mockResolvedValueOnce([
      {
        id: "r-2",
        ready: false,
        buildPack: "dockercompose",
        summary: null,
        nameGuess: null,
        dockerComposeLocation: "/c.yml",
        dockerfileLocation: null,
      },
    ]);

    const { saveReviewResultTool } = await import("./review.js");
    await saveReviewResultTool.execute(
      {
        repoUrl: "x",
        ready: 0,
        buildPack: "dockercompose",
        dockerComposeLocation: "/c.yml",
      },
      ctx,
    );

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        ready: false,
        dockerComposeLocation: "/c.yml",
      }),
    );
  });
});
