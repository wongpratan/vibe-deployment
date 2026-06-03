import { describe, it, expect } from "vitest";
import { makeChatService, ChatNotFoundError } from "./orchestrator.js";
import type { Chat, ChatRepository } from "./chat.repository.js";
import type { Message, MessageRepository, NewMessage } from "./message.repository.js";
import type { ReviewRepository } from "./review.repository.js";
import type { CoordinatorRepository } from "./coordinator.repository.js";

function fakeChats(initial: Chat[] = []) {
  const store: Chat[] = [...initial];
  const calls: { deleted: string[] } = { deleted: [] };
  const repo: ChatRepository = {
    async listForUser(userId) {
      return store
        .filter((c) => c.userId === userId)
        .map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt, appName: null }));
    },
    async findByIdForUser(id, userId) {
      return store.find((c) => c.id === id && c.userId === userId) ?? null;
    },
    async create(userId, title) {
      const c = { id: `chat-${store.length + 1}`, userId, title, createdAt: new Date() } as Chat;
      store.push(c);
      return c;
    },
    async deleteById(id) {
      calls.deleted.push(id);
    },
  };
  return { repo, store, calls };
}

function fakeMessages() {
  const calls = { deletedChatIds: [] as string[], inserted: [] as NewMessage[] };
  const repo: MessageRepository = {
    async listByChatAndAgent() {
      return [];
    },
    async insert(input) {
      calls.inserted.push(input);
    },
    async deleteByChatId(chatId) {
      calls.deletedChatIds.push(chatId);
    },
  };
  return { repo, calls };
}

function fakeReviews() {
  const calls = { deletes: [] as Array<{ chatId: string; userId: string }> };
  const repo: ReviewRepository = {
    findLatestReady: async () => null,
    findLatestReadyForUser: async () => null,
    deleteForChatAndUser: async (chatId, userId) => {
      calls.deletes.push({ chatId, userId });
    },
  };
  return { repo, calls };
}

function fakeCoordinators() {
  const calls = { deletes: [] as Array<{ chatId: string; userId: string }> };
  const repo: CoordinatorRepository = {
    findLatestCollected: async () => null,
    deleteCoordinatorForChatAndUser: async (chatId, userId) => {
      calls.deletes.push({ chatId, userId });
    },
  };
  return { repo, calls };
}

function makeService() {
  const chats = fakeChats();
  const messages = fakeMessages();
  const reviews = fakeReviews();
  const coordinators = fakeCoordinators();
  return {
    svc: makeChatService({
      chats: chats.repo,
      messages: messages.repo,
      reviews: reviews.repo,
      coordinators: coordinators.repo,
    }),
    chats,
    messages,
    reviews,
    coordinators,
  };
}

describe("chatService.getOrCreateChat", () => {
  it("creates a new chat with a 60-char-truncated title when no chatId given", async () => {
    const { svc, chats } = makeService();
    const longMsg = "x".repeat(200);

    const chat = await svc.getOrCreateChat(undefined, "user-1", longMsg);

    expect(chat.title.length).toBe(60);
    expect(chats.store).toHaveLength(1);
    expect(chats.store[0].userId).toBe("user-1");
  });

  it("returns the existing chat when chatId belongs to the user", async () => {
    const { svc, chats } = makeService();
    const existing = await chats.repo.create("user-1", "old");

    const chat = await svc.getOrCreateChat(existing.id, "user-1", "ignored");

    expect(chat.id).toBe(existing.id);
  });

  it("throws ChatNotFoundError when the chatId is not owned by the user", async () => {
    const { svc, chats } = makeService();
    await chats.repo.create("user-1", "old");

    await expect(svc.getOrCreateChat("does-not-exist", "user-1", "hi")).rejects.toBeInstanceOf(
      ChatNotFoundError,
    );
  });
});

describe("chatService.ensureChatForUser", () => {
  it("returns the chat when it exists for the user", async () => {
    const { svc, chats } = makeService();
    const existing = await chats.repo.create("user-1", "t");

    const got = await svc.ensureChatForUser(existing.id, "user-1");

    expect(got?.id).toBe(existing.id);
  });

  it("returns null when not found", async () => {
    const { svc } = makeService();

    expect(await svc.ensureChatForUser("nope", "user-1")).toBeNull();
  });
});

describe("chatService.restartChat", () => {
  it("deletes reviews, coordinator requirements, and messages for the chat", async () => {
    const { svc, reviews, coordinators, messages } = makeService();

    await svc.restartChat("chat-1", "user-1");

    expect(reviews.calls.deletes).toEqual([{ chatId: "chat-1", userId: "user-1" }]);
    expect(coordinators.calls.deletes).toEqual([{ chatId: "chat-1", userId: "user-1" }]);
    expect(messages.calls.deletedChatIds).toEqual(["chat-1"]);
  });
});

describe("chatService.deleteChat", () => {
  it("delegates to the chat repository", async () => {
    const { svc, chats } = makeService();

    await svc.deleteChat("chat-9");

    expect(chats.calls.deleted).toEqual(["chat-9"]);
  });
});

describe("chatService.toHistory", () => {
  function msg(partial: Partial<Message>): Message {
    return {
      id: "m",
      chatId: "c",
      agentId: "reviewer",
      role: "user",
      content: "",
      toolCallId: null,
      toolCalls: null,
      createdAt: new Date(),
      ...partial,
    } as Message;
  }

  it("maps user and assistant messages to plain role/content", () => {
    const { svc } = makeService();

    const out = svc.toHistory([
      msg({ role: "user", content: "hi" }),
      msg({ role: "assistant", content: "hello" }),
    ]);

    expect(out).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("maps tool messages with tool_call_id (defaulting to empty when missing)", () => {
    const { svc } = makeService();

    const out = svc.toHistory([
      msg({ role: "tool", content: "{\"ok\":1}", toolCallId: "call-1" }),
      msg({ role: "tool", content: "", toolCallId: null }),
    ]);

    expect(out).toEqual([
      { role: "tool", tool_call_id: "call-1", content: "{\"ok\":1}" },
      { role: "tool", tool_call_id: "", content: "" },
    ]);
  });

  it("preserves tool_calls on assistant messages and nulls empty content", () => {
    const { svc } = makeService();
    const toolCalls = [{ id: "call-1", type: "function", function: { name: "f", arguments: "{}" } }];

    const out = svc.toHistory([
      msg({ role: "assistant", content: "", toolCalls }),
      msg({ role: "assistant", content: "with text", toolCalls }),
    ]);

    expect(out).toEqual([
      { role: "assistant", content: null, tool_calls: toolCalls },
      { role: "assistant", content: "with text", tool_calls: toolCalls },
    ]);
  });
});
