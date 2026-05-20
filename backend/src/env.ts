import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "production"]).default("development"),
  MODEL: z.string().default("llama3.1"),
  OPENAI_BASE_URL: z.string().url(),
  OPENAI_API_KEY: z.string(),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(16),
  BRAVE_API_KEY: z.string().optional().default(""),
  FRONTEND_ORIGIN: z.string().default("http://localhost:3000"),
  COOLIFY_BASE_URL: z.string().url(),
  COOLIFY_ACCESS_TOKEN: z.string().min(1),
});

export const env = schema.parse(process.env);
