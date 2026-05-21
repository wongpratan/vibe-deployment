import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, asc, desc, sql } from "drizzle-orm";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { db, schema } from "../db/client.js";
import { requireAuth } from "../auth/middleware.js";
import { runChat } from "./service.js";
import { agentIdSchema, AGENT_PROMPTS } from "./prompts.js";

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

  app.get<{ Params: { id: string }; Querystring: { agentId?: string } }>(
    "/chats/:id/messages",
    async (req, reply) => {
      const userId = req.user!.sub;
      const parsedAgent = agentIdSchema.safeParse(req.query.agentId);
      if (!parsedAgent.success) return reply.code(400).send({ error: "invalid agentId" });
      const agentId = parsedAgent.data;
      const [chat] = await db
        .select()
        .from(schema.chats)
        .where(and(eq(schema.chats.id, req.params.id), eq(schema.chats.userId, userId)));
      if (!chat) return reply.code(404).send({ error: "not found" });
      return db
        .select()
        .from(schema.messages)
        .where(and(eq(schema.messages.chatId, chat.id), eq(schema.messages.agentId, agentId)))
        .orderBy(asc(schema.messages.createdAt));
    },
  );

  app.get<{ Params: { id: string } }>("/chats/:id/review-status", async (req, reply) => {
    const userId = req.user!.sub;
    const [chat] = await db
      .select()
      .from(schema.chats)
      .where(and(eq(schema.chats.id, req.params.id), eq(schema.chats.userId, userId)));
    if (!chat) return reply.code(404).send({ error: "not found" });
    const [review] = await db
      .select()
      .from(schema.reviewResults)
      .where(and(eq(schema.reviewResults.chatId, chat.id), eq(schema.reviewResults.ready, true)))
      .orderBy(desc(schema.reviewResults.createdAt))
      .limit(1);
    return { ready: !!review, nameGuess: review?.nameGuess ?? null };
  });

  app.get<{ Params: { id: string } }>("/chats/:id/coordinator-status", async (req, reply) => {
    const userId = req.user!.sub;
    const [chat] = await db
      .select()
      .from(schema.chats)
      .where(and(eq(schema.chats.id, req.params.id), eq(schema.chats.userId, userId)));
    if (!chat) return reply.code(404).send({ error: "not found" });
    const [coords] = await db
      .select()
      .from(schema.coordinatorRequirements)
      .where(
        and(
          eq(schema.coordinatorRequirements.chatId, chat.id),
          eq(schema.coordinatorRequirements.userId, userId),
          eq(schema.coordinatorRequirements.collected, true),
        ),
      )
      .orderBy(desc(schema.coordinatorRequirements.createdAt))
      .limit(1);
    const [review] = await db
      .select()
      .from(schema.reviewResults)
      .where(
        and(
          eq(schema.reviewResults.chatId, chat.id),
          eq(schema.reviewResults.userId, userId),
          eq(schema.reviewResults.ready, true),
        ),
      )
      .orderBy(desc(schema.reviewResults.createdAt))
      .limit(1);
    const envVarsArr = Array.isArray(coords?.envVars) ? (coords!.envVars as Array<{ key?: string }>) : [];
    const envVarKeys = envVarsArr.map((v) => v?.key).filter((k): k is string => typeof k === "string" && k.length > 0);
    return {
      collected: !!coords,
      appName: coords?.appName ?? null,
      envVarKeys,
      buildPack: review?.buildPack ?? null,
    };
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
    const { message, agentId } = parsed.data;
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
      .where(and(eq(schema.messages.chatId, chatId), eq(schema.messages.agentId, agentId)))
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
        content: AGENT_PROMPTS[agentId].system,
      });
      if (agentId === "coordinator") {
        const [review] = await db
          .select()
          .from(schema.reviewResults)
          .where(
            and(
              eq(schema.reviewResults.chatId, chatId),
              eq(schema.reviewResults.userId, userId),
              eq(schema.reviewResults.ready, true),
            ),
          )
          .orderBy(desc(schema.reviewResults.createdAt))
          .limit(1);
        if (review) {
          history.push({
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
        const [coords] = await db
          .select()
          .from(schema.coordinatorRequirements)
          .where(
            and(
              eq(schema.coordinatorRequirements.chatId, chatId),
              eq(schema.coordinatorRequirements.userId, userId),
              eq(schema.coordinatorRequirements.collected, true),
            ),
          )
          .orderBy(desc(schema.coordinatorRequirements.createdAt))
          .limit(1);
        if (coords) {
          const [deployerReview] = await db
            .select()
            .from(schema.reviewResults)
            .where(
              and(
                eq(schema.reviewResults.chatId, chatId),
                eq(schema.reviewResults.userId, userId),
                eq(schema.reviewResults.ready, true),
              ),
            )
            .orderBy(desc(schema.reviewResults.createdAt))
            .limit(1);
          const envVarsArr = Array.isArray(coords.envVars) ? (coords.envVars as Array<{ key?: string }>) : [];
          const envVarKeys = envVarsArr
            .map((v) => v?.key)
            .filter((k): k is string => typeof k === "string" && k.length > 0);
          const lines = ["Coordinator context (requirements collected for this chat):"];
          if (deployerReview?.buildPack) lines.push(`buildPack: ${deployerReview.buildPack}`);
          lines.push(`appName: ${coords.appName}`);
          lines.push(`envVarKeys: ${JSON.stringify(envVarKeys)}`);
          history.push({
            role: "system",
            content: lines.join("\n"),
          });
        } else {
          history.push({
            role: "system",
            content:
              "No coordinator requirements found for this chat. The user has not completed the Coordinator step yet. Reply with exactly this message: \"Please talk to the Coordinator first before using the Deployer.\" Do not mention the Reviewer.",
          });
        }
      }
    }

    history.push({ role: "user", content: message });
    await db.insert(schema.messages).values({ chatId, agentId, role: "user", content: message });

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
                agentId,
                role: "assistant",
                content: typeof m.content === "string" ? m.content : "",
                toolCalls: (m as any).tool_calls ?? null,
              });
            } else if (m.role === "tool") {
              await db.insert(schema.messages).values({
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
