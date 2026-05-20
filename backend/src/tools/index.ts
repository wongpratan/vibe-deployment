import { getCoolifyTools, isCoolifyTool, callCoolifyTool } from "../mcp/coolify.js";

export type ToolContext = { userId: string; chatId: string };

type OpenAITool = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

type StaticTool = {
  schema: OpenAITool;
  execute: (args: any, ctx: ToolContext) => Promise<string>;
};

const staticRegistry: Record<string, StaticTool> = {
  request_user_input: {
    schema: {
      type: "function",
      function: {
        name: "request_user_input",
        description:
          "Ask the user for a specific type of input. Use this instead of asking in plain text when you need a structured value like a URL, color, file, date, or a selection from options. Always use this as the sole tool call in a turn.",
        parameters: {
          type: "object",
          required: ["inputType", "label", "fieldName"],
          properties: {
            inputType: {
              type: "string",
              enum: ["text", "github_url", "url", "email", "number", "color", "date", "file", "password", "select"],
              description: "The type of input widget to show the user.",
            },
            label: {
              type: "string",
              description: "Question or label shown above the input.",
            },
            fieldName: {
              type: "string",
              description:
                "Short noun phrase naming the field (e.g. 'application name', 'GitHub repo URL', 'server UUID'). Used to label the user's reply so the AI never confuses which question the value answers. Use lowercase, no trailing punctuation.",
            },
            placeholder: {
              type: "string",
              description: "Placeholder text inside the input.",
            },
            options: {
              type: "array",
              items: { type: "string" },
              description: "Required when inputType is 'select'. List of options for the user to choose from.",
            },
            required: {
              type: "boolean",
              description: "Whether the user must provide a value.",
            },
          },
        },
      },
    },
    execute: async () => '{"error":"intercepted"}',
  },
};

export async function loadToolSchemas(): Promise<OpenAITool[]> {
  const staticSchemas = Object.values(staticRegistry).map((t) => t.schema);
  try {
    const mcpSchemas = await getCoolifyTools();
    return [...staticSchemas, ...mcpSchemas];
  } catch (err) {
    console.error("[tools] failed to load coolify mcp tools:", err);
    return staticSchemas;
  }
}

export async function dispatchTool(name: string, rawArgs: string, ctx: ToolContext): Promise<string> {
  let args: unknown;
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return JSON.stringify({ error: "invalid JSON arguments" });
  }

  const staticTool = staticRegistry[name];
  if (staticTool) {
    try {
      return await staticTool.execute(args, ctx);
    } catch (err) {
      return JSON.stringify({ error: String(err) });
    }
  }

  try {
    if (await isCoolifyTool(name)) {
      return await callCoolifyTool(name, args);
    }
  } catch (err) {
    return JSON.stringify({ error: String(err) });
  }

  return JSON.stringify({ error: `unknown tool: ${name}` });
}
