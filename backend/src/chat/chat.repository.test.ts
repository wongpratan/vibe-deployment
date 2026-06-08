import { describe, expect, it, vi } from "vitest";
import { DrizzleChatRepository } from "./chat.repository.js";
import { schema } from "../db/client.js";

function makeSelectOrderDb(rows: unknown[]) {
  const orderBy = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { db: { select } as never, select, from, where, orderBy };
}

function makeSelectWhereDb(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { db: { select } as never, select, from, where };
}

function makeInsertDb(returned: unknown[]) {
  const returning = vi.fn().mockResolvedValue(returned);
  const values = vi.fn().mockReturnValue({ returning });
  const insert = vi.fn().mockReturnValue({ values });
  return { db: { insert } as never, insert, values, returning };
}

function makeDeleteDb() {
  const where = vi.fn().mockResolvedValue(undefined);
  const del = vi.fn().mockReturnValue({ where });
  return { db: { delete: del } as never, del, where };
}

describe("DrizzleChatRepository", () => {
  describe("listForUser", () => {
    it("queries chats table and returns rows", async () => {
      const rows = [{ id: "c1", title: "t", createdAt: new Date(), appName: "app" }];
      const { db, from, where, orderBy } = makeSelectOrderDb(rows);
      const repo = new DrizzleChatRepository(db);

      const result = await repo.listForUser("user1");

      expect(result).toEqual(rows);
      expect(from).toHaveBeenCalledWith(schema.chats);
      expect(where).toHaveBeenCalled();
      expect(orderBy).toHaveBeenCalled();
    });
  });

  describe("findByIdForUser", () => {
    it("returns chat when found", async () => {
      const row = { id: "c1", userId: "u1", title: "t", createdAt: new Date() };
      const { db, from } = makeSelectWhereDb([row]);
      const repo = new DrizzleChatRepository(db);

      const result = await repo.findByIdForUser("c1", "u1");

      expect(result).toEqual(row);
      expect(from).toHaveBeenCalledWith(schema.chats);
    });

    it("returns null when missing", async () => {
      const { db } = makeSelectWhereDb([]);
      const repo = new DrizzleChatRepository(db);
      expect(await repo.findByIdForUser("c1", "u1")).toBeNull();
    });
  });

  describe("create", () => {
    it("inserts and returns chat", async () => {
      const row = { id: "c1", userId: "u1", title: "Hi", createdAt: new Date() };
      const { db, insert, values } = makeInsertDb([row]);
      const repo = new DrizzleChatRepository(db);

      const result = await repo.create("u1", "Hi");

      expect(result).toEqual(row);
      expect(insert).toHaveBeenCalledWith(schema.chats);
      expect(values).toHaveBeenCalledWith({ userId: "u1", title: "Hi" });
    });
  });

  describe("deleteById", () => {
    it("deletes chat by id", async () => {
      const { db, del, where } = makeDeleteDb();
      const repo = new DrizzleChatRepository(db);

      await repo.deleteById("c1");

      expect(del).toHaveBeenCalledWith(schema.chats);
      expect(where).toHaveBeenCalled();
    });
  });
});
