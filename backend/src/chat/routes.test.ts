import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { sign } from "../auth/jwt.js";
import { ChatNotFoundError } from "./orchestrator.js";

const { chatRepo, messageRepo, chatSvc, gate, runChatMock } = vi.hoisted(() => ({
  chatRepo: {
    listForUser: vi.fn(),
    findByIdForUser: vi.fn(),
    create: vi.fn(),
    deleteById: vi.fn(),
  },
  messageRepo: {
    listByChatAndAgent: vi.fn(),
    insert: vi.fn(),
    deleteByChatId: vi.fn(),
  },
  chatSvc: {
    ensureChatForUser: vi.fn(),
    getOrCreateChat: vi.fn(),
    restartChat: vi.fn(),
    deleteChat: vi.fn(),
    toHistory: vi.fn(() => []),
  },
  gate: {
    state: vi.fn(),
    isOpen: vi.fn(),
    systemContextPrompt: vi.fn(async () => []),
  },
  runChatMock: vi.fn(),
}));

vi.mock("./chat.repository.js", () => ({ chatRepository: chatRepo }));
vi.mock("./message.repository.js", () => ({ messageRepository: messageRepo }));
vi.mock("./orchestrator.js", async () => {
  const actual = await vi.importActual<typeof import("./orchestrator.js")>("./orchestrator.js");
  return { ...actual, chatService: chatSvc };
});
vi.mock("./workflowGate.js", async () => {
  const actual = await vi.importActual<typeof import("./workflowGate.js")>("./workflowGate.js");
  return { ...actual, workflowGate: gate };
});
vi.mock("./service.js", () => ({
  runChat: (...a: any[]) => runChatMock(...a),
}));

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  const { chatRoutes } = await import("./routes.js");
  await app.register(chatRoutes);
  return app;
}

const token = sign({ sub: "user-1", email: "u@e" });
const authHeaders = { authorization: `Bearer ${token}` };
const uuid = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("auth gating", () => {
  it("rejects /chats without a Bearer token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/chats" });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /chats", () => {
  it("returns the list for the authenticated user", async () => {
    chatRepo.listForUser.mockResolvedValueOnce([{ id: "c1", title: "t" }]);
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/chats", headers: authHeaders });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ id: "c1", title: "t" }]);
    expect(chatRepo.listForUser).toHaveBeenCalledWith("user-1");
  });
});

describe("GET /chats/:id/messages", () => {
  it("400s on invalid agentId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/chats/${uuid}/messages?agentId=nope`,
      headers: authHeaders,
    });
    expect(res.statusCode).toBe(400);
  });

  it("404s when the chat does not belong to the user", async () => {
    chatSvc.ensureChatForUser.mockResolvedValueOnce(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/chats/${uuid}/messages?agentId=reviewer`,
      headers: authHeaders,
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns messages for the chat+agent", async () => {
    chatSvc.ensureChatForUser.mockResolvedValueOnce({ id: "c1" });
    messageRepo.listByChatAndAgent.mockResolvedValueOnce([{ id: "m1" }]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/chats/${uuid}/messages?agentId=reviewer`,
      headers: authHeaders,
    });
    expect(res.json()).toEqual([{ id: "m1" }]);
    expect(messageRepo.listByChatAndAgent).toHaveBeenCalledWith("c1", "reviewer");
  });
});

describe("GET /chats/:id/state", () => {
  it("404s when chat is missing", async () => {
    chatSvc.ensureChatForUser.mockResolvedValueOnce(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/chats/${uuid}/state`,
      headers: authHeaders,
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns wire state", async () => {
    chatSvc.ensureChatForUser.mockResolvedValueOnce({ id: "c1" });
    gate.state.mockResolvedValueOnce({
      reviewer: {
        open: true,
        ready: false,
        nameGuess: null,
        repoUrl: null,
        gitBranch: null,
        buildPack: null,
        dockerComposeLocation: null,
        dockerfileLocation: null,
        envVarsDetected: [],
        summary: null,
      },
      coordinator: { open: false, collected: false, appName: null, envVars: [] },
      deployer: { open: false, targetUrl: null },
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/chats/${uuid}/state`,
      headers: authHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().reviewer.open).toBe(true);
  });
});

describe("POST /chats/:id/restart", () => {
  it("404s when chat missing", async () => {
    chatSvc.ensureChatForUser.mockResolvedValueOnce(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/chats/${uuid}/restart`,
      headers: authHeaders,
    });
    expect(res.statusCode).toBe(404);
  });

  it("calls restartChat and returns ok", async () => {
    chatSvc.ensureChatForUser.mockResolvedValueOnce({ id: "c1" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/chats/${uuid}/restart`,
      headers: authHeaders,
    });
    expect(res.json()).toEqual({ ok: true });
    expect(chatSvc.restartChat).toHaveBeenCalledWith("c1", "user-1");
  });
});

describe("DELETE /chats/:id", () => {
  it("404s when chat missing", async () => {
    chatSvc.ensureChatForUser.mockResolvedValueOnce(null);
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/chats/${uuid}`,
      headers: authHeaders,
    });
    expect(res.statusCode).toBe(404);
  });

  it("calls deleteChat and returns ok", async () => {
    chatSvc.ensureChatForUser.mockResolvedValueOnce({ id: "c1" });
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/chats/${uuid}`,
      headers: authHeaders,
    });
    expect(res.json()).toEqual({ ok: true });
    expect(chatSvc.deleteChat).toHaveBeenCalledWith("c1");
  });
});

describe("POST /chat — pre-stream validation", () => {
  it("400s on invalid input", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/chat",
      headers: authHeaders,
      payload: { message: "", agentId: "reviewer" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("403s when starting a new chat with non-reviewer agent", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/chat",
      headers: authHeaders,
      payload: { message: "hi", agentId: "coordinator" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "stage not open", agentId: "coordinator" });
  });

  it("404s when chatId references an unknown chat", async () => {
    chatSvc.getOrCreateChat.mockRejectedValueOnce(new ChatNotFoundError());
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/chat",
      headers: authHeaders,
      payload: { chatId: uuid, message: "hi", agentId: "reviewer" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("403s when the requested stage is not open", async () => {
    chatSvc.getOrCreateChat.mockResolvedValueOnce({ id: "c1" });
    gate.isOpen.mockResolvedValueOnce(false);
    gate.state.mockResolvedValueOnce({
      reviewer: {
        open: true,
        ready: false,
        nameGuess: null,
        repoUrl: null,
        gitBranch: null,
        buildPack: null,
        dockerComposeLocation: null,
        dockerfileLocation: null,
        envVarsDetected: [],
        summary: null,
      },
      coordinator: { open: false, collected: false, appName: null, envVars: [] },
      deployer: { open: false, targetUrl: null },
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/chat",
      headers: authHeaders,
      payload: { chatId: uuid, message: "hi", agentId: "coordinator" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "stage not open", agentId: "coordinator" });
  });
});

describe("POST /chat — SSE streaming", () => {
  async function streamRun(events: any[]) {
    runChatMock.mockReturnValueOnce(
      (async function* () {
        for (const e of events) yield e;
      })(),
    );
  }

  it("streams events and persists assistant messages on done", async () => {
    chatSvc.getOrCreateChat.mockResolvedValueOnce({ id: "c1" });
    messageRepo.listByChatAndAgent.mockResolvedValueOnce([]);
    await streamRun([
      { type: "text", delta: "hi" },
      {
        type: "done",
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "hello" },
        ],
      },
    ]);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/chat",
      headers: authHeaders,
      payload: { message: "hi", agentId: "reviewer" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-chat-id"]).toBe("c1");
    expect(res.body).toContain('"type":"text"');
    expect(res.body).toContain('"type":"done"');
    expect(messageRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ role: "user", content: "hi" }),
    );
    expect(messageRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ role: "assistant", content: "hello" }),
    );
  });

  it("emits state_changed after gate-signal tool results", async () => {
    chatSvc.getOrCreateChat.mockResolvedValueOnce({ id: "c1" });
    messageRepo.listByChatAndAgent.mockResolvedValueOnce([]);
    await streamRun([
      { type: "tool_result", name: "save_review_result", result: "{}" },
      { type: "done", messages: [{ role: "user", content: "hi" }] },
    ]);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/chat",
      headers: authHeaders,
      payload: { message: "hi", agentId: "reviewer" },
    });

    expect(res.body).toContain('"type":"state_changed"');
  });

  it("emits an error event when the stream throws", async () => {
    chatSvc.getOrCreateChat.mockResolvedValueOnce({ id: "c1" });
    messageRepo.listByChatAndAgent.mockResolvedValueOnce([]);
    runChatMock.mockReturnValueOnce(
      (async function* () {
        yield { type: "text", delta: "x" };
        throw new Error("boom");
      })(),
    );

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/chat",
      headers: authHeaders,
      payload: { message: "hi", agentId: "reviewer" },
    });

    expect(res.body).toContain('"type":"error"');
    expect(res.body).toContain("boom");
  });

  it("persists tool messages with their tool_call_id", async () => {
    chatSvc.getOrCreateChat.mockResolvedValueOnce({ id: "c1" });
    messageRepo.listByChatAndAgent.mockResolvedValueOnce([]);
    await streamRun([
      {
        type: "done",
        messages: [
          { role: "user", content: "hi" },
          { role: "tool", content: "{\"ok\":1}", tool_call_id: "call-1" },
        ],
      },
    ]);

    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/chat",
      headers: authHeaders,
      payload: { message: "hi", agentId: "reviewer" },
    });

    expect(messageRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "tool",
        content: "{\"ok\":1}",
        toolCallId: "call-1",
      }),
    );
  });
});
