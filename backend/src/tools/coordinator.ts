import { db, schema } from "../db/client.js";
import type { ToolContext } from "./deployment.js";

export const saveCoordinatorRequirementsTool = {
  schema: {
    type: "function" as const,
    function: {
      name: "save_coordinator_requirements",
      description:
        "Persist the application name and required environment variables collected by the Coordinator agent. Call exactly once, after the user has confirmed the application name and submitted env var values.",
      parameters: {
        type: "object",
        required: ["appName", "envVars", "collected"],
        properties: {
          appName: {
            type: "string",
            description: "Final application name as confirmed by the user.",
          },
          envVars: {
            type: "array",
            description:
              "Env var entries with values supplied by the user. Empty array allowed when no env vars were detected.",
            items: {
              type: "object",
              required: ["key", "value"],
              properties: {
                key: { type: "string" },
                value: { type: "string" },
                required: { type: "boolean" },
                source: { type: "string" },
              },
            },
          },
          collected: {
            type: "boolean",
            description: "True once both appName and env vars have been collected.",
          },
        },
      },
    },
  },
  execute: async (args: any, ctx: ToolContext): Promise<string> => {
    const [row] = await db
      .insert(schema.coordinatorRequirements)
      .values({
        userId: ctx.userId,
        chatId: ctx.chatId,
        appName: String(args.appName ?? "").trim(),
        envVars: Array.isArray(args.envVars) ? args.envVars : [],
        collected: !!args.collected,
      })
      .returning();
    return JSON.stringify({
      status: "saved",
      id: row.id,
      appName: row.appName,
      envVarCount: Array.isArray(row.envVars) ? (row.envVars as unknown[]).length : 0,
      collected: row.collected,
    });
  },
};
