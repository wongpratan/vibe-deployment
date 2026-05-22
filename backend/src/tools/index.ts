import { saveDeploymentRequirementsTool, type ToolContext } from "./deployment.js";
import { saveReviewResultTool } from "./review.js";
import { saveCoordinatorRequirementsTool } from "./coordinator.js";
import { cloneAndInspectRepoTool } from "./cloneRepo.js";
import { detectBuildPackTool } from "./detectBuildPack.js";
import { searchTool } from "./search.js";
import { setCoolifyEnvVarsTool } from "./coolifySetEnvVars.js";
import { getCoolifyTools, dispatchCoolifyTool, isCoolifyToolName } from "../mcp/coolifyClient.js";
import type { AgentId } from "../chat/prompts.js";

type ToolSchema = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

type Tool = {
  schema: ToolSchema;
  execute: (args: any, ctx: ToolContext) => Promise<string>;
};

const requestUserInputTool: Tool = {
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
            enum: ["text", "github_url", "url", "email", "number", "color", "date", "file", "password", "select", "env_vars"],
            description: "The type of input widget to show the user.",
          },
          label: { type: "string", description: "Question or label shown above the input." },
          fieldName: {
            type: "string",
            description:
              "Short noun phrase naming the field (e.g. 'application name'). Used to label the user's reply so the AI never confuses which question the value answers. Use lowercase, no trailing punctuation.",
          },
          placeholder: { type: "string", description: "Placeholder text inside the input." },
          defaultValue: {
            type: "string",
            description:
              "Optional default value to prefill the input with. User can edit or accept as-is. Useful for suggestions like a detected application name.",
          },
          options: {
            type: "array",
            items: { type: "string" },
            description: "Required when inputType is 'select'. List of options for the user to choose from.",
          },
          envVarSpec: {
            type: "array",
            description:
              "Required when inputType is 'env_vars'. List of environment variables to prompt for. Pass envVarsDetected from the review row verbatim.",
            items: {
              type: "object",
              required: ["key", "required"],
              properties: {
                key: { type: "string" },
                required: { type: "boolean" },
                source: { type: "string" },
                defaultValue: { type: "string" },
              },
            },
          },
          required: { type: "boolean", description: "Whether the user must provide a value." },
        },
      },
    },
  },
  execute: async () => '{"error":"intercepted"}',
};

const webSearchTool: Tool = {
  schema: searchTool.schema,
  execute: (args) => searchTool.execute(args),
};

const registry: Record<string, Tool> = {
  save_deployment_requirements: saveDeploymentRequirementsTool,
  save_review_result: saveReviewResultTool,
  save_coordinator_requirements: saveCoordinatorRequirementsTool,
  clone_and_inspect_repo: cloneAndInspectRepoTool,
  detect_build_pack: detectBuildPackTool,
  web_search: webSearchTool,
  request_user_input: requestUserInputTool,
  set_coolify_env_vars: setCoolifyEnvVarsTool,
};

const AGENT_TOOL_NAMES: Record<AgentId, string[]> = {
  reviewer: [
    "clone_and_inspect_repo",
    "detect_build_pack",
    "web_search",
    "save_review_result",
    "request_user_input",
  ],
  coordinator: ["save_coordinator_requirements", "request_user_input"],
  deployer: ["set_coolify_env_vars", "request_user_input"],
};

export type AgentTools = {
  schemas: ToolSchema[];
  dispatch: (name: string, rawArgs: string, ctx: ToolContext) => Promise<string>;
};

export async function getToolsForAgent(agentId: AgentId): Promise<AgentTools> {
  const names = AGENT_TOOL_NAMES[agentId] ?? [];
  const localSchemas = names
    .map((n) => registry[n]?.schema)
    .filter((s): s is ToolSchema => !!s);
  const coolifySchemas = agentId === "deployer" ? await getCoolifyTools() : [];
  const schemas = [...localSchemas, ...coolifySchemas];

  const allowed = new Set(names);
  const dispatch = async (name: string, rawArgs: string, ctx: ToolContext): Promise<string> => {
    if (isCoolifyToolName(name)) {
      if (agentId !== "deployer") return JSON.stringify({ error: `tool ${name} not allowed for agent ${agentId}` });
      return dispatchCoolifyTool(name, rawArgs);
    }
    if (!allowed.has(name)) return JSON.stringify({ error: `tool ${name} not allowed for agent ${agentId}` });
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
  };

  return { schemas, dispatch };
}
