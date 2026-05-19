import { saveDeploymentRequirementsTool, type ToolContext } from "./deployment.js";

type Tool = {
  schema: {
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  };
  execute: (args: any, ctx: ToolContext) => Promise<string>;
};

const registry: Record<string, Tool> = {
  save_deployment_requirements: saveDeploymentRequirementsTool,
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
              description: "Short noun phrase naming the field (e.g. 'application name', 'GitHub repo URL', 'deploy environment'). Used to label the user's reply so the AI never confuses which question the value answers. Use lowercase, no trailing punctuation.",
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

export const toolSchemas = Object.values(registry).map((t) => t.schema);

export async function dispatchTool(name: string, rawArgs: string, ctx: ToolContext): Promise<string> {
  const tool = registry[name];
  if (!tool) return JSON.stringify({ error: `unknown tool: ${name}` });
  let args: unknown;
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return JSON.stringify({ error: "invalid JSON arguments" });
  }
  try {
    return await tool.execute(args, ctx);
  } catch (err) {
    return JSON.stringify({ error: String(err) });
  }
}
