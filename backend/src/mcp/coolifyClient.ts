import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { env } from "../env.js";

export type OpenAIToolSchema = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

const PREFIX = "coolify_";

let clientPromise: Promise<Client> | null = null;
let cachedToolSchemas: OpenAIToolSchema[] | null = null;
const aliasToOriginal = new Map<string, string>();
let warnedMissingEnv = false;

function hasCreds(): boolean {
  return !!env.COOLIFY_BASE_URL && !!env.COOLIFY_ACCESS_TOKEN;
}

async function connect(): Promise<Client> {
  if (!hasCreds()) {
    throw new Error("Coolify env not configured");
  }
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "@masonator/coolify-mcp@latest"],
    env: {
      ...process.env,
      COOLIFY_BASE_URL: env.COOLIFY_BASE_URL!,
      COOLIFY_ACCESS_TOKEN: env.COOLIFY_ACCESS_TOKEN!,
    } as Record<string, string>,
  });
  const client = new Client({ name: "global-page-nexus-backend", version: "0.1.0" });
  await client.connect(transport);
  return client;
}

function getClient(): Promise<Client> {
  if (!clientPromise) clientPromise = connect();
  return clientPromise;
}

function sanitizeName(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export async function getCoolifyTools(): Promise<OpenAIToolSchema[]> {
  if (!hasCreds()) {
    if (!warnedMissingEnv) {
      warnedMissingEnv = true;
      console.warn("[coolify-mcp] COOLIFY_BASE_URL or COOLIFY_ACCESS_TOKEN not set — skipping MCP tools");
    }
    return [];
  }
  if (cachedToolSchemas) return cachedToolSchemas;
  try {
    const client = await getClient();
    const { tools } = await client.listTools();
    cachedToolSchemas = tools.map((t) => {
      const alias = PREFIX + sanitizeName(t.name);
      aliasToOriginal.set(alias, t.name);
      return {
        type: "function" as const,
        function: {
          name: alias,
          description: t.description ?? t.name,
          parameters: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
        },
      };
    });
    return cachedToolSchemas;
  } catch (err) {
    console.error("[coolify-mcp] failed to list tools:", err);
    cachedToolSchemas = [];
    return [];
  }
}

export function isCoolifyToolName(name: string): boolean {
  return name.startsWith(PREFIX);
}

export async function callCoolifyToolByOriginalName(
  originalName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const client = await getClient();
  const res = await client.callTool({ name: originalName, arguments: args });
  return JSON.stringify(res.content ?? res);
}

export async function dispatchCoolifyTool(aliasName: string, rawArgs: string): Promise<string> {
  if (!hasCreds()) return JSON.stringify({ error: "Coolify env not configured" });
  const original = aliasToOriginal.get(aliasName);
  if (!original) return JSON.stringify({ error: `unknown coolify tool: ${aliasName}` });
  let args: Record<string, unknown> = {};
  if (rawArgs) {
    try {
      args = JSON.parse(rawArgs);
    } catch {
      return JSON.stringify({ error: "invalid JSON arguments" });
    }
  }
  try {
    return await callCoolifyToolByOriginalName(original, args);
  } catch (err) {
    return JSON.stringify({ error: String(err) });
  }
}
