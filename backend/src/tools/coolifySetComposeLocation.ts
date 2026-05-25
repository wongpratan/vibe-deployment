import { env } from "../env.js";
import type { ToolContext } from "./deployment.js";

export const setCoolifyComposeLocationTool = {
  schema: {
    type: "function" as const,
    function: {
      name: "set_coolify_compose_location",
      description:
        "Set docker_compose_location on a Coolify application via the REST API. The Coolify MCP wrapper strips this field, so this local tool PATCHes /applications/{uuid} directly. Call ONLY when buildPack='dockercompose' after creating the application.",
      parameters: {
        type: "object",
        required: ["applicationUuid", "dockerComposeLocation"],
        properties: {
          applicationUuid: {
            type: "string",
            description: "Coolify application UUID returned by coolify_application create_public.",
          },
          dockerComposeLocation: {
            type: "string",
            description: "Repo-root path (leading slash) to the compose file, e.g. '/docker/compose.yml'.",
          },
        },
      },
    },
  },
  execute: async (
    args: { applicationUuid?: string; dockerComposeLocation?: string },
    _ctx: ToolContext,
  ): Promise<string> => {
    if (!args?.applicationUuid) return JSON.stringify({ error: "applicationUuid required" });
    if (!args?.dockerComposeLocation) return JSON.stringify({ error: "dockerComposeLocation required" });
    if (!env.COOLIFY_BASE_URL || !env.COOLIFY_ACCESS_TOKEN) {
      return JSON.stringify({ error: "Coolify env not configured" });
    }
    const base = env.COOLIFY_BASE_URL.replace(/\/+$/, "");
    const url = `${base}/api/v1/applications/${args.applicationUuid}`;
    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.COOLIFY_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({ docker_compose_location: args.dockerComposeLocation }),
      });
      const text = await res.text();
      if (!res.ok) {
        return JSON.stringify({ error: `HTTP ${res.status}`, body: text.slice(0, 500) });
      }
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {}
      return JSON.stringify({ status: "ok", dockerComposeLocation: args.dockerComposeLocation, result: parsed });
    } catch (err) {
      return JSON.stringify({ error: String(err) });
    }
  },
};
