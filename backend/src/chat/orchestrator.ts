import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { chatRepository, type ChatRepository, type Chat } from "./chat.repository.js";
import { messageRepository, type MessageRepository } from "./message.repository.js";
import { reviewRepository, type ReviewRepository } from "./review.repository.js";
import { coordinatorRepository, type CoordinatorRepository } from "./coordinator.repository.js";

export interface ChatService {
  ensureChatForUser(chatId: string, userId: string): Promise<Chat | null>;
  getOrCreateChat(chatId: string | undefined, userId: string, message: string): Promise<Chat>;
  restartChat(chatId: string, userId: string): Promise<void>;
  deleteChat(chatId: string): Promise<void>;
  toHistory(messages: Awaited<ReturnType<MessageRepository["listByChatAndAgent"]>>): ChatCompletionMessageParam[];
}

interface Deps {
  chats: ChatRepository;
  messages: MessageRepository;
  reviews: ReviewRepository;
  coordinators: CoordinatorRepository;
}

export function makeChatService(deps: Deps): ChatService {
  const { chats, messages, reviews, coordinators } = deps;

  return {
    ensureChatForUser(chatId, userId) {
      return chats.findByIdForUser(chatId, userId);
    },

    async getOrCreateChat(chatId, userId, message) {
      if (chatId) {
        const chat = await chats.findByIdForUser(chatId, userId);
        if (!chat) throw new ChatNotFoundError();
        return chat;
      }
      return chats.create(userId, message.slice(0, 60));
    },

    async restartChat(chatId, userId) {
      await reviews.deleteForChatAndUser(chatId, userId);
      await coordinators.deleteCoordinatorForChatAndUser(chatId, userId);
      await messages.deleteByChatId(chatId);
    },

    async deleteChat(chatId) {
      await chats.deleteById(chatId);
    },

    toHistory(prior) {
      return prior.map((m) => {
        if (m.role === "tool") {
          return {
            role: "tool",
            tool_call_id: m.toolCallId ?? "",
            content: m.content,
          };
        }
        if (m.role === "assistant" && m.toolCalls) {
          return {
            role: "assistant",
            content: m.content || null,
            tool_calls: m.toolCalls as any,
          };
        }
        return { role: m.role as "user" | "assistant" | "system", content: m.content };
      });
    },
  };
}

export class ChatNotFoundError extends Error {
  constructor() {
    super("chat not found");
    this.name = "ChatNotFoundError";
  }
}

export const chatService = makeChatService({
  chats: chatRepository,
  messages: messageRepository,
  reviews: reviewRepository,
  coordinators: coordinatorRepository,
});
