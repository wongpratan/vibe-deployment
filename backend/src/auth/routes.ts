import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authService, BadCredentialsError, EmailTakenError } from "./service.js";

const credSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/register", async (req, reply) => {
    const parsed = credSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid input" });
    try {
      return await authService.register(parsed.data.email, parsed.data.password);
    } catch (err) {
      if (err instanceof EmailTakenError) return reply.code(409).send({ error: err.message });
      throw err;
    }
  });

  app.post("/auth/login", async (req, reply) => {
    const parsed = credSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid input" });
    try {
      return await authService.login(parsed.data.email, parsed.data.password);
    } catch (err) {
      if (err instanceof BadCredentialsError) return reply.code(401).send({ error: err.message });
      throw err;
    }
  });
}
