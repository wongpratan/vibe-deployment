import { env } from "../env.js";
import type { ToolContext } from "./types.js";

export const setCoolifyGitBranchTool = {
  schema: {
    type: "function" as const,
    function: {
      name: "set_coolify_git_branch",
      description:
        "Set git_branch on a Coolify application via the REST API. The Coolify MCP wrapper does not reliably persist git_branch on create_public, so this local tool PATCHes /applications/{uuid} directly. Call after creating the application and before triggering deploy.",
      parameters: {
        type: "object",
        required: ["applicationUuid", "gitBranch"],
        properties: {
          applicationUuid: {
            type: "string",
            description: "Coolify application UUID returned by coolify_application create_public.",
          },
          gitBranch: {
            type: "string",
            description: "Git branch to deploy from, e.g. 'main' or 'master'.",
          },
        },
      },
    },
  },
  execute: async (
    args: { applicationUuid?: string; gitBranch?: string },
    _ctx: ToolContext,
  ): Promise<string> => {
    if (!args?.applicationUuid) return JSON.stringify({ error: "applicationUuid required" });
    if (!args?.gitBranch) return JSON.stringify({ error: "gitBranch required" });
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
        body: JSON.stringify({ git_branch: args.gitBranch }),
      });
      const text = await res.text();
      if (!res.ok) {
        return JSON.stringify({ error: `HTTP ${res.status}`, body: text.slice(0, 500) });
      }
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {}
      return JSON.stringify({ status: "ok", gitBranch: args.gitBranch, result: parsed });
    } catch (err) {
      return JSON.stringify({ error: String(err) });
    }
  },
};
