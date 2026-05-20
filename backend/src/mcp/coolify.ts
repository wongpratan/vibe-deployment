import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { env } from "../env.js";

type OpenAITool = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

let client: Client | null = null;
let connecting: Promise<Client> | null = null;
let cachedTools: OpenAITool[] | null = null;
let cachedToolNames: Set<string> | null = null;

async function connect(): Promise<Client> {
  if (client) return client;
  if (connecting) return connecting;

  connecting = (async () => {
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["@masonator/coolify-mcp"],
      env: {
        ...process.env,
        COOLIFY_BASE_URL: env.COOLIFY_BASE_URL,
        COOLIFY_ACCESS_TOKEN: env.COOLIFY_ACCESS_TOKEN,
      },
    });

    const c = new Client({ name: "global-page-nexus-backend", version: "0.1.0" }, { capabilities: {} });

    transport.onclose = () => {
      console.warn("[coolify-mcp] transport closed; will reconnect on next call");
      client = null;
      cachedTools = null;
      cachedToolNames = null;
    };
    transport.onerror = (err) => {
      console.error("[coolify-mcp] transport error:", err);
    };

    await c.connect(transport);
    console.log("[coolify-mcp] connected");
    client = c;
    return c;
  })();

  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

export async function getCoolifyTools(): Promise<OpenAITool[]> {
  if (cachedTools) return cachedTools;
  const c = await connect();
  const { tools } = await c.listTools();
  const mapped: OpenAITool[] = tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
    },
  }));
  cachedTools = mapped;
  cachedToolNames = new Set(mapped.map((m) => m.function.name));
  return mapped;
}

export async function isCoolifyTool(name: string): Promise<boolean> {
  if (!cachedToolNames) await getCoolifyTools();
  return cachedToolNames?.has(name) ?? false;
}

export async function callCoolifyTool(name: string, args: unknown): Promise<string> {
  const c = await connect();
  const result = await c.callTool({
    name,
    arguments: (args ?? {}) as Record<string, unknown>,
  });
  const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
  const text = content
    .map((c) => (c.type === "text" && c.text ? c.text : JSON.stringify(c)))
    .join("\n");
  if (result.isError) {
    return JSON.stringify({ error: text || "coolify mcp error" });
  }
  return text || JSON.stringify({ status: "ok" });
}
