import { coordinatorRepository } from "../chat/coordinator.repository.js";
import { callCoolifyToolByOriginalName } from "../mcp/coolifyClient.js";
import type { ToolContext } from "./deployment.js";

export const setCoolifyEnvVarsTool = {
  schema: {
    type: "function" as const,
    function: {
      name: "set_coolify_env_vars",
      description:
        "Set ALL environment variables on a Coolify application using the values the Coordinator already collected. The values themselves are not exposed to you — pass only the Coolify application UUID. Returns the bulk-update result.",
      parameters: {
        type: "object",
        required: ["applicationUuid"],
        properties: {
          applicationUuid: {
            type: "string",
            description: "Coolify application UUID returned by the application create tool.",
          },
        },
      },
    },
  },
  execute: async (args: { applicationUuid?: string }, ctx: ToolContext): Promise<string> => {
    if (!args?.applicationUuid) {
      return JSON.stringify({ error: "applicationUuid required" });
    }
    const coords = await coordinatorRepository.findLatestCollected(ctx.chatId, ctx.userId);
    if (!coords) return JSON.stringify({ error: "no coordinator requirements found for this chat" });
    const rawList = Array.isArray(coords.envVars)
      ? (coords.envVars as Array<{ key?: string; value?: string }>)
      : [];
    const data = rawList
      .filter((v) => typeof v?.key === "string" && v.key.length > 0)
      .map((v) => ({ key: v.key as string, value: typeof v.value === "string" ? v.value : "" }));
    if (data.length === 0) return JSON.stringify({ status: "skipped", reason: "no env vars to set" });
    try {
      const result = await callCoolifyToolByOriginalName("env_vars", {
        resource: "application",
        action: "bulk_update",
        uuid: args.applicationUuid,
        data,
      });
      return JSON.stringify({ status: "ok", count: data.length, result: JSON.parse(result) });
    } catch (err) {
      return JSON.stringify({ error: String(err) });
    }
  },
};
