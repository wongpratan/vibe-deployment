import { env } from "../env.js";
import type { ToolContext } from "./deployment.js";

const TERMINAL_STATUSES = new Set(["finished", "failed", "cancelled", "canceled", "error"]);
const POLL_INTERVAL_MS = 10_000;
const MAX_POLLS = 30;

type CoolifyDeployment = {
  status?: string;
  logs?: string;
  finished_at?: string | null;
  created_at?: string | null;
};

type CoolifyApplication = {
  fqdn?: string | null;
  domains?: string | null;
};

function coolifyHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${env.COOLIFY_ACCESS_TOKEN}`,
  };
}

function normalizeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim();
  if (!first) return null;
  if (/^https?:\/\//i.test(first)) return first;
  return `https://${first}`;
}

function extractLogsTail(logsField: unknown, maxLines = 50): string | null {
  if (!logsField) return null;
  let text: string;
  if (typeof logsField === "string") {
    text = logsField;
  } else {
    try {
      text = JSON.stringify(logsField);
    } catch {
      return null;
    }
  }
  const lines = text.split(/\r?\n/);
  return lines.slice(-maxLines).join("\n");
}

async function fetchDeployment(base: string, uuid: string): Promise<CoolifyDeployment | { error: string }> {
  const res = await fetch(`${base}/api/v1/deployments/${uuid}`, { headers: coolifyHeaders() });
  const text = await res.text();
  if (!res.ok) return { error: `HTTP ${res.status}: ${text.slice(0, 300)}` };
  try {
    return JSON.parse(text) as CoolifyDeployment;
  } catch {
    return { error: `non-JSON response: ${text.slice(0, 200)}` };
  }
}

async function fetchApplication(base: string, uuid: string): Promise<CoolifyApplication | null> {
  try {
    const res = await fetch(`${base}/api/v1/applications/${uuid}`, { headers: coolifyHeaders() });
    if (!res.ok) return null;
    const text = await res.text();
    return JSON.parse(text) as CoolifyApplication;
  } catch {
    return null;
  }
}

export const waitForDeploymentTool = {
  schema: {
    type: "function" as const,
    function: {
      name: "wait_for_deployment",
      description:
        "Poll Coolify until the given deployment reaches a terminal status (finished/failed/cancelled), then fetch the application's FQDN. Returns { status, url, deploymentUuid, durationMs, polls, logsTail? }. Call ONCE after coolify_deploy; do not manually loop coolify_deployment yourself.",
      parameters: {
        type: "object",
        required: ["deploymentUuid", "applicationUuid"],
        properties: {
          deploymentUuid: {
            type: "string",
            description: "Deployment UUID returned by coolify_deploy.",
          },
          applicationUuid: {
            type: "string",
            description: "Coolify application UUID (used to fetch fqdn after deploy completes).",
          },
        },
      },
    },
  },
  execute: async (
    args: { deploymentUuid?: string; applicationUuid?: string },
    _ctx: ToolContext,
  ): Promise<string> => {
    if (!args?.deploymentUuid) return JSON.stringify({ error: "deploymentUuid required" });
    if (!args?.applicationUuid) return JSON.stringify({ error: "applicationUuid required" });
    if (!env.COOLIFY_BASE_URL || !env.COOLIFY_ACCESS_TOKEN) {
      return JSON.stringify({ error: "Coolify env not configured" });
    }
    const base = env.COOLIFY_BASE_URL.replace(/\/+$/, "");
    const start = Date.now();

    let last: CoolifyDeployment | null = null;
    let polls = 0;
    let status = "unknown";
    let timedOut = false;

    for (let i = 0; i < MAX_POLLS; i++) {
      polls = i + 1;
      const r = await fetchDeployment(base, args.deploymentUuid);
      if ("error" in r) {
        return JSON.stringify({
          status: "poll_error",
          error: r.error,
          deploymentUuid: args.deploymentUuid,
          polls,
          durationMs: Date.now() - start,
        });
      }
      last = r;
      status = (r.status ?? "unknown").toLowerCase();
      if (TERMINAL_STATUSES.has(status)) break;
      if (i < MAX_POLLS - 1) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      } else {
        timedOut = true;
      }
    }

    const succeeded = status === "finished";
    const app = succeeded ? await fetchApplication(base, args.applicationUuid) : null;
    const url = app ? normalizeUrl(app.fqdn ?? app.domains ?? null) : null;
    const logsTail = succeeded ? null : extractLogsTail(last?.logs);

    return JSON.stringify({
      status: timedOut && !TERMINAL_STATUSES.has(status) ? "timeout" : status,
      url,
      deploymentUuid: args.deploymentUuid,
      applicationUuid: args.applicationUuid,
      polls,
      durationMs: Date.now() - start,
      ...(logsTail ? { logsTail } : {}),
    });
  },
};
