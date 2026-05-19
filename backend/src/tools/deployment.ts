import { db, schema } from "../db/client.js";

export type ToolContext = { userId: string; chatId: string };

export const saveDeploymentRequirementsTool = {
  schema: {
    type: "function" as const,
    function: {
      name: "save_deployment_requirements",
      description:
        "Persist the user's collected application deployment requirements. Call exactly once, after every required field has been gathered.",
      parameters: {
        type: "object",
        required: [
          "appName",
          "repoUrl",
          "environment",
          "runtime",
          "runtimeVersion",
          "cpu",
          "memory",
          "replicas",
        ],
        properties: {
          appName: { type: "string" },
          repoUrl: { type: "string" },
          environment: { type: "string", enum: ["dev", "staging", "prod"] },
          runtime: { type: "string", description: "node|python|go|java|etc" },
          runtimeVersion: { type: "string" },
          cpu: { type: "string", description: "e.g. 500m, 2" },
          memory: { type: "string", description: "e.g. 512Mi, 2Gi" },
          replicas: { type: "number" },
        },
      },
    },
  },
  execute: async (args: any, ctx: ToolContext): Promise<string> => {
    const [row] = await db
      .insert(schema.deploymentRequirements)
      .values({
        userId: ctx.userId,
        chatId: ctx.chatId,
        requirements: args,
      })
      .returning();
    return JSON.stringify({ status: "saved", id: row.id });
  },
};
