import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

import { POST as chatPOST } from "./chat/route";
import { GET as chatsGET } from "./chats/route";
import { DELETE as chatDELETE } from "./chats/[id]/route";
import { GET as messagesGET } from "./chats/[id]/messages/route";
import { GET as stateGET } from "./chats/[id]/state/route";
import { POST as restartPOST } from "./chats/[id]/restart/route";
import { POST as logoutPOST } from "./logout/route";
import { POST as authPOST } from "./auth/[action]/route";

const BACKEND = "http://backend:4000";
const TOKEN = "tkn-123";

function requestWithCookie(url: string, init: RequestInit = {}, token = TOKEN) {
  return new NextRequest(url, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      cookie: `auth_token=${token}`,
    },
  });
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// /api/chat
// ---------------------------------------------------------------------------
describe("POST /api/chat", () => {
  it("returns 401 when auth cookie is missing", async () => {
    const req = new NextRequest("http://app/api/chat", {
      method: "POST",
      body: JSON.stringify({ message: "hi" }),
    });
    const res = await chatPOST(req);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("proxies SSE body and forwards X-Chat-Id when upstream succeeds", async () => {
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode("data: hi\n\n"));
        c.close();
      },
    });
    fetchSpy.mockResolvedValueOnce(
      new Response(upstreamBody, {
        status: 200,
        headers: { "X-Chat-Id": "chat-7" },
      }),
    );

    const req = requestWithCookie("http://app/api/chat", {
      method: "POST",
      body: JSON.stringify({ message: "hi" }),
    });
    const res = await chatPOST(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("X-Chat-Id")).toBe("chat-7");
    expect(await res.text()).toBe("data: hi\n\n");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${BACKEND}/chat`);
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
    });
  });

  it("forwards upstream error status and body when upstream fails", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("nope", { status: 502 }));
    const req = requestWithCookie("http://app/api/chat", {
      method: "POST",
      body: "{}",
    });
    const res = await chatPOST(req);
    expect(res.status).toBe(502);
    expect(await res.text()).toBe("nope");
  });
});

// ---------------------------------------------------------------------------
// /api/chats
// ---------------------------------------------------------------------------
describe("GET /api/chats", () => {
  it("returns 401 without auth cookie", async () => {
    const req = new NextRequest("http://app/api/chats");
    const res = await chatsGET(req);
    expect(res.status).toBe(401);
  });

  it("proxies upstream JSON with auth header", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse([{ id: "a" }]));
    const req = requestWithCookie("http://app/api/chats");
    const res = await chatsGET(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "a" }]);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${BACKEND}/chats`);
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
    });
  });
});

// ---------------------------------------------------------------------------
// /api/chats/[id] DELETE
// ---------------------------------------------------------------------------
describe("DELETE /api/chats/[id]", () => {
  it("returns 401 without auth cookie", async () => {
    const req = new NextRequest("http://app/api/chats/x", { method: "DELETE" });
    const res = await chatDELETE(req, { params: Promise.resolve({ id: "x" }) });
    expect(res.status).toBe(401);
  });

  it("forwards DELETE to backend with URL-encoded id", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const req = requestWithCookie("http://app/api/chats/abc%20def", {
      method: "DELETE",
    });
    const res = await chatDELETE(req, {
      params: Promise.resolve({ id: "abc def" }),
    });
    expect(res.status).toBe(200);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${BACKEND}/chats/abc%20def`);
    expect((init as RequestInit).method).toBe("DELETE");
  });
});

// ---------------------------------------------------------------------------
// /api/chats/[id]/messages
// ---------------------------------------------------------------------------
describe("GET /api/chats/[id]/messages", () => {
  it("returns 401 without auth cookie", async () => {
    const req = new NextRequest("http://app/api/chats/x/messages");
    const res = await messagesGET(req, {
      params: Promise.resolve({ id: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("forwards agentId query string when present", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse([{ role: "user", content: "hi" }]));
    const req = requestWithCookie(
      "http://app/api/chats/x/messages?agentId=reviewer",
    );
    const res = await messagesGET(req, {
      params: Promise.resolve({ id: "x" }),
    });
    expect(res.status).toBe(200);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      `${BACKEND}/chats/x/messages?agentId=reviewer`,
    );
  });

  it("omits the query string when agentId is absent", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse([]));
    const req = requestWithCookie("http://app/api/chats/x/messages");
    await messagesGET(req, { params: Promise.resolve({ id: "x" }) });
    expect(fetchSpy.mock.calls[0][0]).toBe(`${BACKEND}/chats/x/messages`);
  });
});

// ---------------------------------------------------------------------------
// /api/chats/[id]/state
// ---------------------------------------------------------------------------
describe("GET /api/chats/[id]/state", () => {
  it("returns 401 without auth cookie", async () => {
    const req = new NextRequest("http://app/api/chats/x/state");
    const res = await stateGET(req, { params: Promise.resolve({ id: "x" }) });
    expect(res.status).toBe(401);
  });

  it("forwards upstream status and body", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ reviewer: { ready: true } }));
    const req = requestWithCookie("http://app/api/chats/x/state");
    const res = await stateGET(req, { params: Promise.resolve({ id: "x" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reviewer: { ready: true } });
    expect(fetchSpy.mock.calls[0][0]).toBe(`${BACKEND}/chats/x/state`);
  });
});

// ---------------------------------------------------------------------------
// /api/chats/[id]/restart
// ---------------------------------------------------------------------------
describe("POST /api/chats/[id]/restart", () => {
  it("returns 401 without auth cookie", async () => {
    const req = new NextRequest("http://app/api/chats/x/restart", {
      method: "POST",
    });
    const res = await restartPOST(req, { params: Promise.resolve({ id: "x" }) });
    expect(res.status).toBe(401);
  });

  it("forwards POST to backend restart endpoint", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const req = requestWithCookie("http://app/api/chats/x/restart", {
      method: "POST",
    });
    const res = await restartPOST(req, {
      params: Promise.resolve({ id: "x" }),
    });
    expect(res.status).toBe(200);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${BACKEND}/chats/x/restart`);
    expect((init as RequestInit).method).toBe("POST");
  });
});

// ---------------------------------------------------------------------------
// /api/logout
// ---------------------------------------------------------------------------
describe("POST /api/logout", () => {
  it("returns ok and clears the auth cookie", async () => {
    const res = await logoutPOST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/auth_token=/);
    // Cleared cookies use Max-Age=0 or an Expires in the past
    expect(setCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
  });
});

// ---------------------------------------------------------------------------
// /api/auth/[action]
// ---------------------------------------------------------------------------
describe("POST /api/auth/[action]", () => {
  it("returns 404 for unknown actions", async () => {
    const req = new NextRequest("http://app/api/auth/whatever", {
      method: "POST",
      body: "{}",
    });
    const res = await authPOST(req, {
      params: Promise.resolve({ action: "whatever" }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown action" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sets auth cookie and returns user on successful login", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ token: "deadbeef", user: { id: "u1", name: "Pong" } }),
    );

    const req = new NextRequest("http://app/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "p@x", password: "pw" }),
    });
    const res = await authPOST(req, {
      params: Promise.resolve({ action: "login" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: { id: "u1", name: "Pong" } });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/auth_token=deadbeef/);
    expect(setCookie).toMatch(/HttpOnly/i);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${BACKEND}/auth/login`);
    expect((init as RequestInit).method).toBe("POST");
  });

  it("forwards upstream error and does not set a cookie on failed login", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ error: "bad creds" }, { status: 401 }),
    );

    const req = new NextRequest("http://app/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "p@x", password: "wrong" }),
    });
    const res = await authPOST(req, {
      params: Promise.resolve({ action: "login" }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "bad creds" });
    expect(res.headers.get("set-cookie") ?? "").not.toMatch(/auth_token=/);
  });

  it("accepts the 'register' action", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ token: "tk", user: { id: "u2" } }),
    );
    const req = new NextRequest("http://app/api/auth/register", {
      method: "POST",
      body: "{}",
    });
    const res = await authPOST(req, {
      params: Promise.resolve({ action: "register" }),
    });
    expect(res.status).toBe(200);
    expect(fetchSpy.mock.calls[0][0]).toBe(`${BACKEND}/auth/register`);
  });
});
