import { describe, it, expect, vi } from "vitest";
import { requireAuth } from "./middleware.js";
import { sign } from "./jwt.js";

function fakeReply() {
  const reply = {
    statusCode: 0,
    body: null as unknown,
    code(c: number) {
      this.statusCode = c;
      return this;
    },
    send(b: unknown) {
      this.body = b;
      return this;
    },
  };
  return reply;
}

describe("requireAuth", () => {
  it("rejects requests with no Authorization header", async () => {
    const req = { headers: {} } as any;
    const reply = fakeReply();

    await requireAuth(req, reply as any);

    expect(reply.statusCode).toBe(401);
    expect(reply.body).toEqual({ error: "missing token" });
    expect(req.user).toBeUndefined();
  });

  it("rejects requests with a non-Bearer scheme", async () => {
    const req = { headers: { authorization: "Basic abc" } } as any;
    const reply = fakeReply();

    await requireAuth(req, reply as any);

    expect(reply.statusCode).toBe(401);
    expect(reply.body).toEqual({ error: "missing token" });
  });

  it("rejects when the token is invalid", async () => {
    const req = { headers: { authorization: "Bearer not-a-jwt" } } as any;
    const reply = fakeReply();

    await requireAuth(req, reply as any);

    expect(reply.statusCode).toBe(401);
    expect(reply.body).toEqual({ error: "invalid token" });
  });

  it("populates req.user when the token is valid", async () => {
    const token = sign({ sub: "user-7", email: "a@b" });
    const req = { headers: { authorization: `Bearer ${token}` } } as any;
    const reply = fakeReply();

    await requireAuth(req, reply as any);

    expect(reply.statusCode).toBe(0);
    expect(req.user).toMatchObject({ sub: "user-7", email: "a@b" });
  });
});
