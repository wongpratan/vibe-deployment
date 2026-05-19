import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, asc, sql } from "drizzle-orm";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { db, schema } from "../db/client.js";
import { requireAuth } from "../auth/middleware.js";
import { runChat } from "./service.js";

const sendSchema = z.object({
  chatId: z.string().uuid().optional(),
  message: z.string().min(1),
});

export async function chatRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req, reply) => {
    if (req.url.startsWith("/chat")) await requireAuth(req, reply);
  });

  app.get("/chats", async (req) => {
    const userId = req.user!.sub;
    return db
      .select({
        id: schema.chats.id,
        title: schema.chats.title,
        createdAt: schema.chats.createdAt,
        appName: sql<string | null>`${schema.deploymentRequirements.requirements}->>'appName'`.as("appName"),
      })
      .from(schema.chats)
      .leftJoin(
        schema.deploymentRequirements,
        eq(schema.deploymentRequirements.chatId, schema.chats.id),
      )
      .where(eq(schema.chats.userId, userId))
      .orderBy(asc(schema.chats.createdAt));
  });

  app.get<{ Params: { id: string } }>("/chats/:id/messages", async (req, reply) => {
    const userId = req.user!.sub;
    const [chat] = await db
      .select()
      .from(schema.chats)
      .where(and(eq(schema.chats.id, req.params.id), eq(schema.chats.userId, userId)));
    if (!chat) return reply.code(404).send({ error: "not found" });
    return db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.chatId, chat.id))
      .orderBy(asc(schema.messages.createdAt));
  });

  app.delete<{ Params: { id: string } }>("/chats/:id", async (req, reply) => {
    const userId = req.user!.sub;
    const [chat] = await db
      .select()
      .from(schema.chats)
      .where(and(eq(schema.chats.id, req.params.id), eq(schema.chats.userId, userId)));
    if (!chat) return reply.code(404).send({ error: "not found" });
    await db.delete(schema.chats).where(eq(schema.chats.id, chat.id));
    return { ok: true };
  });

  app.post("/chat", async (req, reply) => {
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid input" });
    const { message } = parsed.data;
    const userId = req.user!.sub;

    let chatId = parsed.data.chatId;
    if (chatId) {
      const [chat] = await db
        .select()
        .from(schema.chats)
        .where(and(eq(schema.chats.id, chatId), eq(schema.chats.userId, userId)));
      if (!chat) return reply.code(404).send({ error: "chat not found" });
    } else {
      const [chat] = await db
        .insert(schema.chats)
        .values({ userId, title: message.slice(0, 60) })
        .returning();
      chatId = chat.id;
    }

    const prior = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.chatId, chatId))
      .orderBy(asc(schema.messages.createdAt));

    const history: ChatCompletionMessageParam[] = prior.map((m) => {
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

    if (history.length === 0) {
      history.unshift({
        role: "system",
        content:
          "You collect application deployment requirements from the user. Ask for these fields in this exact order, one at a time, using the `request_user_input` tool as the sole tool in that turn — never ask for these values in plain text: 1. app name, 2. git repo URL, 3. environment (dev/staging/prod), 4. runtime, 5. runtime version, 6. CPU, 7. memory, 8. replica count. Use inputType `text` for app name / runtime / runtime version / cpu / memory, `github_url` for repo URL, `select` with options [\"dev\",\"staging\",\"prod\"] for environment, and `number` for replicas. Always pass `fieldName` as a short lowercase noun phrase identifying the field (e.g. \"application name\", \"git repo URL\", \"deploy environment\", \"runtime\", \"runtime version\", \"CPU\", \"memory\", \"replica count\"). The user's next message will arrive in the form `My <fieldName> is \"<value>\".` — use the `fieldName` to disambiguate which field the value belongs to. After every field is collected, call `save_deployment_requirements` exactly once with all eight fields, then end the turn with no further text. Do not call any other tools.",
      });
    }

    history.push({ role: "user", content: message });
    await db.insert(schema.messages).values({ chatId, role: "user", content: message });

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
              await db.insert(schema.messages).values({
                chatId,
                role: "assistant",
                content: typeof m.content === "string" ? m.content : "",
                toolCalls: (m as any).tool_calls ?? null,
              });
            } else if (m.role === "tool") {
              await db.insert(schema.messages).values({
                chatId,
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
