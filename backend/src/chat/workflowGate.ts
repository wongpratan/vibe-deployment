import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { env } from "../env.js";
import { reviewRepository, type ReviewRepository } from "./review.repository.js";
import { coordinatorRepository, type CoordinatorRepository } from "./coordinator.repository.js";
import { AGENT_PROMPTS, type AgentId } from "./prompts.js";

export type StageId = "reviewer" | "coordinator" | "deployer";

export interface WorkflowState {
  reviewer: {
    open: true;
    ready: boolean;
    nameGuess: string | null;
    repoUrl: string | null;
    gitBranch: string | null;
    buildPack: string | null;
    dockerComposeLocation: string | null;
    dockerfileLocation: string | null;
    envVarsDetected: unknown;
    summary: string | null;
  };
  coordinator: {
    open: boolean;
    collected: boolean;
    appName: string | null;
    envVars: Array<{ key: string; value: string }>;
  };
  deployer: {
    open: boolean;
    targetUrl: string | null;
  };
}

export interface WireWorkflowState {
  reviewer: { open: true; ready: boolean; nameGuess: string | null };
  coordinator: {
    open: boolean;
    collected: boolean;
    appName: string | null;
    envVarKeys: string[];
    envVars: Array<{ key: string; maskedValue: string }>;
  };
  deployer: {
    open: boolean;
    buildPack: string | null;
    targetUrl: string | null;
  };
}

export interface WorkflowGate {
  state(chatId: string, userId: string): Promise<WorkflowState>;
  isOpen(chatId: string, userId: string, stage: StageId): Promise<boolean>;
  systemContextPrompt(
    chatId: string,
    userId: string,
    agentId: AgentId,
  ): Promise<ChatCompletionMessageParam[]>;
}

export const GATE_SIGNAL_TOOLS: ReadonlySet<string> = new Set([
  "save_review_result",
  "save_coordinator_requirements",
]);

function maskEnvValue(v: string): string {
  if (v.length === 0) return "(empty)";
  if (v.length < 7) return v;
  return "••••" + v.slice(-4);
}

export function toWireState(s: WorkflowState): WireWorkflowState {
  const envVars = s.coordinator.envVars.map((v) => ({
    key: v.key,
    maskedValue: maskEnvValue(v.value),
  }));
  return {
    reviewer: {
      open: true,
      ready: s.reviewer.ready,
      nameGuess: s.reviewer.nameGuess,
    },
    coordinator: {
      open: s.coordinator.open,
      collected: s.coordinator.collected,
      appName: s.coordinator.appName,
      envVarKeys: envVars.map((v) => v.key),
      envVars,
    },
    deployer: {
      open: s.deployer.open,
      buildPack: s.reviewer.buildPack,
      targetUrl: s.deployer.targetUrl,
    },
  };
}

export function makeWorkflowGate(deps: {
  reviews: ReviewRepository;
  coordinators: CoordinatorRepository;
}): WorkflowGate {
  const { reviews, coordinators } = deps;

  async function state(chatId: string, userId: string): Promise<WorkflowState> {
    const review = await reviews.findLatestReadyForUser(chatId, userId);
    const coords = await coordinators.findLatestCollected(chatId, userId);
    const reviewerReady = !!review;
    const collected = !!coords;

    const envVarsRaw = Array.isArray(coords?.envVars)
      ? (coords!.envVars as Array<{ key?: string; value?: string }>)
      : [];
    const envVars = envVarsRaw
      .filter((v): v is { key: string; value?: string } => typeof v?.key === "string" && v.key.length > 0)
      .map((v) => ({ key: v.key, value: typeof v.value === "string" ? v.value : "" }));

    const targetUrl =
      coords?.appName && env.COOLIFY_APPS_DOMAIN
        ? `https://${coords.appName}.${env.COOLIFY_APPS_DOMAIN}`
        : null;

    return {
      reviewer: {
        open: true,
        ready: reviewerReady,
        nameGuess: review?.nameGuess ?? null,
        repoUrl: review?.repoUrl ?? null,
        gitBranch: review?.gitBranch ?? null,
        buildPack: review?.buildPack ?? null,
        dockerComposeLocation: review?.dockerComposeLocation ?? null,
        dockerfileLocation: review?.dockerfileLocation ?? null,
        envVarsDetected: review?.envVarsDetected ?? [],
        summary: review?.summary ?? null,
      },
      coordinator: {
        open: reviewerReady,
        collected,
        appName: coords?.appName ?? null,
        envVars,
      },
      deployer: {
        open: collected,
        targetUrl,
      },
    };
  }

  async function isOpen(chatId: string, userId: string, stage: StageId): Promise<boolean> {
    const s = await state(chatId, userId);
    return s[stage].open;
  }

  async function systemContextPrompt(
    chatId: string,
    userId: string,
    agentId: AgentId,
  ): Promise<ChatCompletionMessageParam[]> {
    const out: ChatCompletionMessageParam[] = [
      { role: "system", content: AGENT_PROMPTS[agentId].system },
    ];
    const s = await state(chatId, userId);

    if (agentId === "coordinator" && s.reviewer.ready) {
      out.push({
        role: "system",
        content: [
          "Review context (latest ready review for this chat):",
          `repoUrl: ${s.reviewer.repoUrl ?? ""}`,
          `buildPack: ${s.reviewer.buildPack ?? "unknown"}`,
          `nameGuess: ${s.reviewer.nameGuess ?? ""}`,
          `envVarsDetected: ${JSON.stringify(s.reviewer.envVarsDetected ?? [])}`,
          `reviewSummary: ${s.reviewer.summary ?? ""}`,
        ].join("\n"),
      });
    }

    if (agentId === "deployer" && s.coordinator.collected) {
      const lines = ["Coordinator context (requirements collected for this chat):"];
      if (s.reviewer.buildPack) lines.push(`buildPack: ${s.reviewer.buildPack}`);
      if (s.reviewer.repoUrl) lines.push(`repoUrl: ${s.reviewer.repoUrl}`);
      lines.push(
        s.reviewer.gitBranch
          ? `gitBranch: ${s.reviewer.gitBranch}`
          : `gitBranch: unknown — ask the user what branch to deploy from`,
      );
      if (s.reviewer.buildPack === "dockercompose") {
        lines.push(`dockerComposeLocation: ${s.reviewer.dockerComposeLocation ?? "(not set)"}`);
      }
      if (s.reviewer.buildPack === "dockerfile") {
        lines.push(`dockerfileLocation: ${s.reviewer.dockerfileLocation ?? "(not set)"}`);
      }
      lines.push(`appName: ${s.coordinator.appName}`);
      lines.push(`envVarKeys: ${JSON.stringify(s.coordinator.envVars.map((v) => v.key))}`);
      if (env.COOLIFY_APPS_DOMAIN) {
        lines.push(`coolifyAppsDomain: ${env.COOLIFY_APPS_DOMAIN}`);
        lines.push(`expectedAppUrl: https://${s.coordinator.appName}.${env.COOLIFY_APPS_DOMAIN}`);
      }
      out.push({ role: "system", content: lines.join("\n") });
    }

    return out;
  }

  return { state, isOpen, systemContextPrompt };
}

export const workflowGate = makeWorkflowGate({
  reviews: reviewRepository,
  coordinators: coordinatorRepository,
});
