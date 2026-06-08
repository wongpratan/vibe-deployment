import { describe, expect, it, vi } from "vitest";
import { DrizzleReviewRepository } from "./review.repository.js";
import { schema } from "../db/client.js";

function makeSelectLimitDb(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { db: { select } as never, from, where, orderBy, limit };
}

function makeDeleteDb() {
  const where = vi.fn().mockResolvedValue(undefined);
  const del = vi.fn().mockReturnValue({ where });
  return { db: { delete: del } as never, del, where };
}

const reviewRow = {
  id: "r1",
  userId: "u1",
  chatId: "c1",
  repoUrl: "https://x",
  gitBranch: null,
  buildPack: null,
  ready: true,
  issues: null,
  notes: null,
  summary: null,
  nameGuess: null,
  envVarsDetected: null,
  dockerComposeLocation: null,
  dockerfileLocation: null,
  createdAt: new Date(),
};

describe("DrizzleReviewRepository", () => {
  describe("findLatestReady", () => {
    it("returns latest ready review for chat", async () => {
      const { db, from, limit } = makeSelectLimitDb([reviewRow]);
      const repo = new DrizzleReviewRepository(db);

      const result = await repo.findLatestReady("c1");

      expect(result).toEqual(reviewRow);
      expect(from).toHaveBeenCalledWith(schema.reviewResults);
      expect(limit).toHaveBeenCalledWith(1);
    });

    it("returns null when no ready review", async () => {
      const { db } = makeSelectLimitDb([]);
      const repo = new DrizzleReviewRepository(db);
      expect(await repo.findLatestReady("c1")).toBeNull();
    });
  });

  describe("findLatestReadyForUser", () => {
    it("returns review when found", async () => {
      const { db, from } = makeSelectLimitDb([reviewRow]);
      const repo = new DrizzleReviewRepository(db);

      const result = await repo.findLatestReadyForUser("c1", "u1");

      expect(result).toEqual(reviewRow);
      expect(from).toHaveBeenCalledWith(schema.reviewResults);
    });

    it("returns null when missing", async () => {
      const { db } = makeSelectLimitDb([]);
      const repo = new DrizzleReviewRepository(db);
      expect(await repo.findLatestReadyForUser("c1", "u1")).toBeNull();
    });
  });

  describe("deleteForChatAndUser", () => {
    it("deletes review rows", async () => {
      const { db, del, where } = makeDeleteDb();
      const repo = new DrizzleReviewRepository(db);

      await repo.deleteForChatAndUser("c1", "u1");

      expect(del).toHaveBeenCalledWith(schema.reviewResults);
      expect(where).toHaveBeenCalled();
    });
  });
});
