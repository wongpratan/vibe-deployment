import { describe, expect, it, vi } from "vitest";
import { DrizzleUserRepository } from "./user.repository.js";
import { schema } from "../db/client.js";

function makeSelectDb(rows: unknown[]) {
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

describe("DrizzleUserRepository", () => {
  describe("findByEmail", () => {
    it("returns user when row exists", async () => {
      const row = { id: "u1", email: "a@b.com", passwordHash: "h", createdAt: new Date() };
      const { db, select, from, where } = makeSelectDb([row]);
      const repo = new DrizzleUserRepository(db);

      const result = await repo.findByEmail("a@b.com");

      expect(result).toEqual(row);
      expect(select).toHaveBeenCalled();
      expect(from).toHaveBeenCalledWith(schema.users);
      expect(where).toHaveBeenCalled();
    });

    it("returns null when no row", async () => {
      const { db } = makeSelectDb([]);
      const repo = new DrizzleUserRepository(db);
      expect(await repo.findByEmail("missing@x")).toBeNull();
    });
  });

  describe("create", () => {
    it("inserts and returns user", async () => {
      const row = { id: "u1", email: "a@b.com", passwordHash: "h", createdAt: new Date() };
      const { db, insert, values } = makeInsertDb([row]);
      const repo = new DrizzleUserRepository(db);

      const result = await repo.create({ email: "a@b.com", passwordHash: "h" });

      expect(result).toEqual(row);
      expect(insert).toHaveBeenCalledWith(schema.users);
      expect(values).toHaveBeenCalledWith({ email: "a@b.com", passwordHash: "h" });
    });
  });
});
