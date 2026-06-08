import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./env.js";
import { authRoutes } from "./auth/routes.js";
import { chatRoutes } from "./chat/routes.js";

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? true });
  await app.register(cors, {
    origin: env.FRONTEND_ORIGIN,
    credentials: true,
  });
  app.get("/health", async () => ({ ok: true }));
  await app.register(authRoutes);
  await app.register(chatRoutes);
  return app;
}
