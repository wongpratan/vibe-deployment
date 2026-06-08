import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { EmailTakenError, BadCredentialsError } from "./service.js";

const register = vi.fn();
const login = vi.fn();

vi.mock("./service.js", async () => {
  const actual = await vi.importActual<typeof import("./service.js")>("./service.js");
  return {
    ...actual,
    authService: { register: (...a: any[]) => register(...a), login: (...a: any[]) => login(...a) },
  };
});

async function buildApp() {
  const app = Fastify();
  const { authRoutes } = await import("./routes.js");
  await app.register(authRoutes);
  return app;
}

beforeEach(() => {
  register.mockReset();
  login.mockReset();
});

describe("POST /auth/register", () => {
  it("rejects bodies that don't match the schema with 400", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/auth/register", payload: { email: "x", password: "1" } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid input" });
    expect(register).not.toHaveBeenCalled();
  });

  it("returns the auth payload on success", async () => {
    register.mockResolvedValueOnce({ token: "tok", user: { id: "u1", email: "a@b.io" } });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "a@b.io", password: "hunter22" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ token: "tok", user: { id: "u1", email: "a@b.io" } });
    expect(register).toHaveBeenCalledWith("a@b.io", "hunter22");
  });

  it("returns 409 when the email is already taken", async () => {
    register.mockRejectedValueOnce(new EmailTakenError());
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "a@b.io", password: "hunter22" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "email taken" });
  });

  it("propagates unexpected errors as 500", async () => {
    register.mockRejectedValueOnce(new Error("db down"));
    const app = await buildApp();
    app.setErrorHandler((_err, _req, reply) => reply.code(500).send({ error: "boom" }));

    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "a@b.io", password: "hunter22" },
    });

    expect(res.statusCode).toBe(500);
  });
});

describe("POST /auth/login", () => {
  it("returns 401 when credentials are bad", async () => {
    login.mockRejectedValueOnce(new BadCredentialsError());
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "a@b.io", password: "hunter22" },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "bad credentials" });
  });

  it("returns the auth payload on success", async () => {
    login.mockResolvedValueOnce({ token: "tok", user: { id: "u1", email: "a@b.io" } });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "a@b.io", password: "hunter22" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ token: "tok", user: { id: "u1", email: "a@b.io" } });
  });

  it("rejects invalid input with 400", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "x", password: "1" } });
    expect(res.statusCode).toBe(400);
  });
});
