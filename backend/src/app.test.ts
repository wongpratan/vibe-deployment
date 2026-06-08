import { describe, it, expect, vi } from "vitest";

vi.mock("./auth/routes.js", () => ({
  authRoutes: async (app: any) => {
    app.get("/__auth_sentinel", async () => ({ ok: "auth" }));
  },
}));

vi.mock("./chat/routes.js", () => ({
  chatRoutes: async (app: any) => {
    app.get("/__chat_sentinel", async () => ({ ok: "chat" }));
  },
}));

async function makeApp() {
  const { buildApp } = await import("./app.js");
  return buildApp({ logger: false });
}

describe("buildApp", () => {
  it("exposes GET /health returning {ok:true}", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("mounts authRoutes", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/__auth_sentinel" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: "auth" });
  });

  it("mounts chatRoutes", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/__chat_sentinel" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: "chat" });
  });

  it("allows CORS from the configured FRONTEND_ORIGIN with credentials", async () => {
    const app = await makeApp();
    const allowed = await app.inject({
      method: "OPTIONS",
      url: "/health",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "GET",
      },
    });
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");
  });

});
