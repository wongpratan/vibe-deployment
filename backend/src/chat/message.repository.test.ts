import { describe, expect, it, vi } from "vitest";
import { DrizzleMessageRepository } from "./message.repository.js";
import { schema } from "../db/client.js";

function makeSelectOrderDb(rows: unknown[]) {
  const orderBy = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { db: { select } as never, from, where, orderBy };
}

function makeInsertDb() {
  const values = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn().mockReturnValue({ values });
  return { db: { insert } as never, insert, values };
}

function makeDeleteDb() {
  const where = vi.fn().mockResolvedValue(undefined);
  const del = vi.fn().mockReturnValue({ where });
  return { db: { delete: del } as never, del, where };
}

describe("DrizzleMessageRepository", () => {
  describe("listByChatAndAgent", () => {
    it("returns messages for chat and agent", async () => {
      const rows = [
        { id: "m1", chatId: "c1", agentId: "reviewer", role: "user", content: "hi", toolCalls: null, toolCallId: null, name: null, createdAt: new Date() },
      ];
      const { db, from, where, orderBy } = makeSelectOrderDb(rows);
      const repo = new DrizzleMessageRepository(db);

      const result = await repo.listByChatAndAgent("c1", "reviewer");

      expect(result).toEqual(rows);
      expect(from).toHaveBeenCalledWith(schema.messages);
      expect(where).toHaveBeenCalled();
      expect(orderBy).toHaveBeenCalled();
    });
  });

  describe("insert", () => {
    it("inserts row", async () => {
      const { db, insert, values } = makeInsertDb();
      const repo = new DrizzleMessageRepository(db);

      const input = { chatId: "c1", agentId: "reviewer", role: "user", content: "hi" };
      await repo.insert(input);

      expect(insert).toHaveBeenCalledWith(schema.messages);
      expect(values).toHaveBeenCalledWith(input);
    });
  });

  describe("deleteByChatId", () => {
    it("deletes messages by chat id", async () => {
      const { db, del, where } = makeDeleteDb();
      const repo = new DrizzleMessageRepository(db);

      await repo.deleteByChatId("c1");

      expect(del).toHaveBeenCalledWith(schema.messages);
      expect(where).toHaveBeenCalled();
    });
  });
});
