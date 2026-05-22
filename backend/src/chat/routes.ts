import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { requireAuth } from "../auth/middleware.js";
import { runChat } from "./service.js";
import { agentIdSchema } from "./prompts.js";
import { chatRepository } from "./chat.repository.js";
import { messageRepository } from "./message.repository.js";
import { chatService, ChatNotFoundError } from "./orchestrator.js";

const sendSchema = z.object({
  chatId: z.string().uuid().optional(),
  message: z.string().min(1),
  agentId: agentIdSchema,
});

export async function chatRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req, reply) => {
    if (req.url.startsWith("/chat")) await requireAuth(req, reply);
  });

  app.get("/chats", async (req) => {
    return chatRepository.listForUser(req.user!.sub);
  });

  app.get<{ Params: { id: string }; Querystring: { agentId?: string } }>(
    "/chats/:id/messages",
    async (req, reply) => {
      const userId = req.user!.sub;
      const parsedAgent = agentIdSchema.safeParse(req.query.agentId);
      if (!parsedAgent.success) return reply.code(400).send({ error: "invalid agentId" });
      const chat = await chatService.ensureChatForUser(req.params.id, userId);
      if (!chat) return reply.code(404).send({ error: "not found" });
      return messageRepository.listByChatAndAgent(chat.id, parsedAgent.data);
    },
  );

  app.get<{ Params: { id: string } }>("/chats/:id/review-status", async (req, reply) => {
    const userId = req.user!.sub;
    const chat = await chatService.ensureChatForUser(req.params.id, userId);
    if (!chat) return reply.code(404).send({ error: "not found" });
    return chatService.getReviewStatus(chat.id);
  });

  app.get<{ Params: { id: string } }>("/chats/:id/coordinator-status", async (req, reply) => {
    const userId = req.user!.sub;
    const chat = await chatService.ensureChatForUser(req.params.id, userId);
    if (!chat) return reply.code(404).send({ error: "not found" });
    return chatService.getCoordinatorStatus(chat.id, userId);
  });

  app.post<{ Params: { id: string } }>("/chats/:id/restart", async (req, reply) => {
    const userId = req.user!.sub;
    const chat = await chatService.ensureChatForUser(req.params.id, userId);
    if (!chat) return reply.code(404).send({ error: "not found" });
    await chatService.restartChat(chat.id, userId);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/chats/:id", async (req, reply) => {
    const userId = req.user!.sub;
    const chat = await chatService.ensureChatForUser(req.params.id, userId);
    if (!chat) return reply.code(404).send({ error: "not found" });
    await chatService.deleteChat(chat.id);
    return { ok: true };
  });

  app.post("/chat", async (req, reply) => {
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid input" });
    const { message, agentId } = parsed.data;
    const userId = req.user!.sub;

    let chat;
    try {
      chat = await chatService.getOrCreateChat(parsed.data.chatId, userId, message);
    } catch (err) {
      if (err instanceof ChatNotFoundError) return reply.code(404).send({ error: "chat not found" });
      throw err;
    }
    const chatId = chat.id;

    const prior = await messageRepository.listByChatAndAgent(chatId, agentId);
    const history: ChatCompletionMessageParam[] = chatService.toHistory(prior);

    if (history.length === 0) {
      const initial = await chatService.buildInitialSystemContext(chatId, userId, agentId);
      history.unshift(...initial);
    }

    history.push({ role: "user", content: message });
    await messageRepository.insert({ chatId, agentId, role: "user", content: message });

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Chat-Id": chatId,
    });

    const send = (data: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      for await (const ev of runChat(history, { userId, chatId })) {
        send(ev);
        if (ev.type === "done") {
          const finalMessages = ev.messages.slice(history.length);
          for (const m of finalMessages) {
            if (m.role === "assistant") {
              await messageRepository.insert({
                chatId,
                agentId,
                role: "assistant",
                content: typeof m.content === "string" ? m.content : "",
                toolCalls: (m as any).tool_calls ?? null,
              });
            } else if (m.role === "tool") {
              await messageRepository.insert({
                chatId,
                agentId,
                role: "tool",
                content: typeof m.content === "string" ? m.content : "",
                toolCallId: (m as any).tool_call_id,
              });
            }
          }
        }
      }
    } catch (err) {
      send({ type: "error", message: String(err) });
    }
    reply.raw.end();
  });
}
