import { describe, expect, it, vi } from "vitest";
import { DrizzleCoordinatorRepository } from "./coordinator.repository.js";
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

describe("DrizzleCoordinatorRepository", () => {
  describe("findLatestCollected", () => {
    it("returns record when found", async () => {
      const row = {
        id: "r1",
        userId: "u1",
        chatId: "c1",
        appName: "app",
        envVars: {},
        collected: true,
        createdAt: new Date(),
      };
      const { db, from, where, limit } = makeSelectLimitDb([row]);
      const repo = new DrizzleCoordinatorRepository(db);

      const result = await repo.findLatestCollected("c1", "u1");

      expect(result).toEqual(row);
      expect(from).toHaveBeenCalledWith(schema.coordinatorRequirements);
      expect(where).toHaveBeenCalled();
      expect(limit).toHaveBeenCalledWith(1);
    });

    it("returns null when not found", async () => {
      const { db } = makeSelectLimitDb([]);
      const repo = new DrizzleCoordinatorRepository(db);
      expect(await repo.findLatestCollected("c1", "u1")).toBeNull();
    });
  });

  describe("deleteCoordinatorForChatAndUser", () => {
    it("deletes from coordinator table", async () => {
      const { db, del, where } = makeDeleteDb();
      const repo = new DrizzleCoordinatorRepository(db);

      await repo.deleteCoordinatorForChatAndUser("c1", "u1");

      expect(del).toHaveBeenCalledWith(schema.coordinatorRequirements);
      expect(where).toHaveBeenCalled();
    });
  });
});
