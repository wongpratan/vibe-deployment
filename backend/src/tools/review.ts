import { db, schema } from "../db/client.js";
import type { ToolContext } from "./deployment.js";

export const saveReviewResultTool = {
  schema: {
    type: "function" as const,
    function: {
      name: "save_review_result",
      description:
        "Persist the Coolify deployment-readiness review for a GitHub repo. Call once per review cycle (each time you reach a verdict, ready or not).",
      parameters: {
        type: "object",
        required: ["repoUrl", "ready"],
        properties: {
          repoUrl: { type: "string", description: "GitHub repo URL that was reviewed." },
          ready: { type: "boolean", description: "True if repo is deployable on Coolify as-is." },
          buildPack: {
            type: "string",
            enum: ["nixpacks", "static", "dockerfile", "dockercompose"],
            description: "Detected Coolify build pack. Omit if undetermined.",
          },
          issues: {
            type: "array",
            description: "Blocking issues. Empty when ready=true.",
            items: {
              type: "object",
              required: ["missing", "suggestion"],
              properties: {
                missing: { type: "string", description: "What is missing or wrong." },
                suggestion: { type: "string", description: "Concrete fix for the user." },
              },
            },
          },
          notes: { type: "string", description: "Short summary of the verdict." },
          summary: {
            type: "string",
            description:
              "Narrative summary of the review for the downstream Deployer agent. Required when ready=true. Cover repo URL, detected build pack, why it is deployable, and any non-blocking improvements.",
          },
          nameGuess: {
            type: "string",
            description:
              "Application name guess produced by clone_and_inspect_repo. Pass through verbatim from the clone tool result so the Coordinator can pre-fill the name prompt.",
          },
          envVarsDetected: {
            type: "array",
            description:
              "Environment variables detected by clone_and_inspect_repo. Pass through verbatim from the clone tool result. Empty array when none detected.",
            items: {
              type: "object",
              required: ["key", "required"],
              properties: {
                key: { type: "string" },
                source: { type: "string" },
                required: { type: "boolean" },
                defaultValue: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
  execute: async (args: any, ctx: ToolContext): Promise<string> => {
    const [row] = await db
      .insert(schema.reviewResults)
      .values({
        userId: ctx.userId,
        chatId: ctx.chatId,
        repoUrl: args.repoUrl,
        buildPack: args.buildPack ?? null,
        ready: !!args.ready,
        issues: args.issues ?? [],
        notes: args.notes ?? null,
        summary: args.summary ?? null,
        nameGuess: args.nameGuess ?? null,
        envVarsDetected: args.envVarsDetected ?? null,
      })
      .returning();
    return JSON.stringify({
      status: "saved",
      id: row.id,
      ready: row.ready,
      buildPack: row.buildPack,
      hasSummary: !!row.summary,
      nameGuess: row.nameGuess ?? null,
    });
  },
};
