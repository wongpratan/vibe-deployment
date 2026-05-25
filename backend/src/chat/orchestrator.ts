import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { chatRepository, type ChatRepository, type Chat } from "./chat.repository.js";
import { messageRepository, type MessageRepository } from "./message.repository.js";
import { reviewRepository, type ReviewRepository } from "./review.repository.js";
import { coordinatorRepository, type CoordinatorRepository } from "./coordinator.repository.js";
import { AGENT_PROMPTS, type AgentId } from "./prompts.js";
import { env } from "../env.js";

function maskEnvValue(v: unknown): string {
  if (typeof v !== "string" || v.length === 0) return "(empty)";
  if (v.length < 7) return v;
  return "••••" + v.slice(-4);
}

export interface CoordinatorStatus {
  collected: boolean;
  appName: string | null;
  envVarKeys: string[];
  envVars: Array<{ key: string; maskedValue: string }>;
  buildPack: string | null;
}

export interface ReviewStatus {
  ready: boolean;
  nameGuess: string | null;
}

export interface ChatService {
  ensureChatForUser(chatId: string, userId: string): Promise<Chat | null>;
  getOrCreateChat(chatId: string | undefined, userId: string, message: string): Promise<Chat>;
  getReviewStatus(chatId: string): Promise<ReviewStatus>;
  getCoordinatorStatus(chatId: string, userId: string): Promise<CoordinatorStatus>;
  restartChat(chatId: string, userId: string): Promise<void>;
  deleteChat(chatId: string): Promise<void>;
  buildInitialSystemContext(
    chatId: string,
    userId: string,
    agentId: AgentId,
  ): Promise<ChatCompletionMessageParam[]>;
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

    async getReviewStatus(chatId) {
      const review = await reviews.findLatestReady(chatId);
      return { ready: !!review, nameGuess: review?.nameGuess ?? null };
    },

    async getCoordinatorStatus(chatId, userId) {
      const coords = await coordinators.findLatestCollected(chatId, userId);
      const review = await reviews.findLatestReadyForUser(chatId, userId);
      const envVarsArrRaw = Array.isArray(coords?.envVars)
        ? (coords!.envVars as Array<{ key?: string; value?: string }>)
        : [];
      const envVars = envVarsArrRaw
        .filter((v): v is { key: string; value?: string } => typeof v?.key === "string" && v.key.length > 0)
        .map((v) => ({ key: v.key, maskedValue: maskEnvValue(v.value) }));
      const envVarKeys = envVars.map((v) => v.key);
      return {
        collected: !!coords,
        appName: coords?.appName ?? null,
        envVarKeys,
        envVars,
        buildPack: review?.buildPack ?? null,
      };
    },

    async restartChat(chatId, userId) {
      await reviews.deleteForChatAndUser(chatId, userId);
      await coordinators.deleteCoordinatorForChatAndUser(chatId, userId);
      await coordinators.deleteDeploymentForChatAndUser(chatId, userId);
      await messages.deleteByChatId(chatId);
    },

    async deleteChat(chatId) {
      await chats.deleteById(chatId);
    },

    async buildInitialSystemContext(chatId, userId, agentId) {
      const out: ChatCompletionMessageParam[] = [
        { role: "system", content: AGENT_PROMPTS[agentId].system },
      ];
      if (agentId === "coordinator") {
        const review = await reviews.findLatestReadyForUser(chatId, userId);
        if (review) {
          out.push({
            role: "system",
            content: [
              "Review context (latest ready review for this chat):",
              `repoUrl: ${review.repoUrl}`,
              `buildPack: ${review.buildPack ?? "unknown"}`,
              `nameGuess: ${review.nameGuess ?? ""}`,
              `envVarsDetected: ${JSON.stringify(review.envVarsDetected ?? [])}`,
              `reviewSummary: ${review.summary ?? ""}`,
            ].join("\n"),
          });
        }
      }
      if (agentId === "deployer") {
        const coords = await coordinators.findLatestCollected(chatId, userId);
        if (coords) {
          const deployerReview = await reviews.findLatestReadyForUser(chatId, userId);
          const envVarsArr = Array.isArray(coords.envVars) ? (coords.envVars as Array<{ key?: string }>) : [];
          const envVarKeys = envVarsArr
            .map((v) => v?.key)
            .filter((k): k is string => typeof k === "string" && k.length > 0);
          const lines = ["Coordinator context (requirements collected for this chat):"];
          if (deployerReview?.buildPack) lines.push(`buildPack: ${deployerReview.buildPack}`);
          if (deployerReview?.repoUrl) lines.push(`repoUrl: ${deployerReview.repoUrl}`);
          if (deployerReview?.buildPack === "dockercompose") {
            lines.push(`dockerComposeLocation: ${deployerReview.dockerComposeLocation ?? "(not set)"}`);
          }
          if (deployerReview?.buildPack === "dockerfile") {
            lines.push(`dockerfileLocation: ${deployerReview.dockerfileLocation ?? "(not set)"}`);
          }
          lines.push(`appName: ${coords.appName}`);
          lines.push(`envVarKeys: ${JSON.stringify(envVarKeys)}`);
          if (env.COOLIFY_APPS_DOMAIN) {
            lines.push(`coolifyAppsDomain: ${env.COOLIFY_APPS_DOMAIN}`);
            lines.push(`expectedAppFqdn: ${coords.appName}.${env.COOLIFY_APPS_DOMAIN}`);
            lines.push(`expectedAppUrl: https://${coords.appName}.${env.COOLIFY_APPS_DOMAIN}`);
          }
          out.push({ role: "system", content: lines.join("\n") });
        } else {
          out.push({
            role: "system",
            content:
              'No coordinator requirements found for this chat. The user has not completed the Coordinator step yet. Reply with exactly this message: "Please talk to the Coordinator first before using the Deployer." Do not mention the Reviewer.',
          });
        }
      }
      return out;
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
