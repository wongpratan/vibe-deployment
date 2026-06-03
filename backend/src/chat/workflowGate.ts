import { env } from "../env.js";
import { reviewRepository, type ReviewRepository } from "./review.repository.js";
import { coordinatorRepository, type CoordinatorRepository } from "./coordinator.repository.js";

export type StageId = "reviewer" | "coordinator" | "deployer";

export interface WorkflowState {
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
}

export const GATE_SIGNAL_TOOLS: ReadonlySet<string> = new Set([
  "save_review_result",
  "save_coordinator_requirements",
]);

function maskEnvValue(v: unknown): string {
  if (typeof v !== "string" || v.length === 0) return "(empty)";
  if (v.length < 7) return v;
  return "••••" + v.slice(-4);
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
      .map((v) => ({ key: v.key, maskedValue: maskEnvValue(v.value) }));
    const envVarKeys = envVars.map((v) => v.key);

    const targetUrl =
      coords?.appName && env.COOLIFY_APPS_DOMAIN
        ? `https://${coords.appName}.${env.COOLIFY_APPS_DOMAIN}`
        : null;

    return {
      reviewer: { open: true, ready: reviewerReady, nameGuess: review?.nameGuess ?? null },
      coordinator: {
        open: reviewerReady,
        collected,
        appName: coords?.appName ?? null,
        envVarKeys,
        envVars,
      },
      deployer: {
        open: collected,
        buildPack: review?.buildPack ?? null,
        targetUrl,
      },
    };
  }

  async function isOpen(chatId: string, userId: string, stage: StageId): Promise<boolean> {
    const s = await state(chatId, userId);
    return s[stage].open;
  }

  return { state, isOpen };
}

export const workflowGate = makeWorkflowGate({
  reviews: reviewRepository,
  coordinators: coordinatorRepository,
});
