import type { InputRequest } from "@/components/DynamicInput";

export type Msg =
  | { role: "user" | "assistant"; content: string }
  | { role: "tool"; name: string; content: string };

export type DeployerContext = {
  collected: boolean;
  appName: string | null;
  envVarKeys: string[];
  envVars: { key: string; maskedValue: string }[];
  buildPack: string | null;
  targetUrl: string | null;
};

function maskEnvVarsPayload(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.envVars)) return null;
    const keys = parsed.envVars
      .map((v: { key: string }) => v.key)
      .filter(Boolean);
    if (keys.length === 0) return "Env vars: (none)";
    return `Env vars set: ${keys.join(", ")}`;
  } catch {
    return null;
  }
}

export function unwrapUserPayload(content: string): string {
  const m1 = content.match(/^My .+? is "([\s\S]*)"\.$/);
  if (m1) return maskEnvVarsPayload(m1[1]) ?? m1[1];
  const m2 = content.match(/^Answer to ".+?": ([\s\S]*)$/);
  if (m2) return maskEnvVarsPayload(m2[1]) ?? m2[1];
  return content;
}

export function coordinatorGreeting(nameGuess: string | null): Msg {
  const suffix = nameGuess
    ? ` I suggested **${nameGuess}** below — keep it or type a different name.`
    : "";
  return {
    role: "assistant",
    content: `Hi! I'm the Coordinator. Confirm the application name below, then I'll collect any environment variables it needs.${suffix}`,
  };
}

export function coordinatorAppNameInput(nameGuess: string | null): InputRequest {
  return {
    inputType: "text",
    label: "Application name?",
    fieldName: "application name",
    defaultValue: nameGuess ?? undefined,
    required: true,
    toolCallId: "",
  };
}

export function deployerGreeting(ctx: DeployerContext | null): Msg {
  if (!ctx || !ctx.collected) {
    return {
      role: "assistant",
      content:
        "Hi! I'm the Deployer. I help execute and monitor deployments. What would you like to deploy?",
    };
  }
  const bp = ctx.buildPack ?? "not detected";
  const name = ctx.appName ?? "(not set)";
  const envBlock =
    ctx.envVars.length > 0
      ? [
          "**Environment Variables:**",
          "",
          "| Key | Value |",
          "| --- | --- |",
          ...ctx.envVars.map((v) => `| \`${v.key}\` | \`${v.maskedValue}\` |`),
        ].join("\n")
      : "- **Environment Variables:** none";
  const lines = [
    "Hi! I'm the Deployer. Here's what's ready to deploy:",
    "",
    `- **Build Pack:** ${bp}`,
    `- **Application Name:** ${name}`,
  ];
  if (ctx.targetUrl) lines.push(`- **Target URL:** <${ctx.targetUrl}>`);
  lines.push(
    "",
    envBlock,
    "",
    "Would you like to **deploy now**, or go **back to the Coordinator** to change the settings?",
  );
  return { role: "assistant", content: lines.join("\n") };
}
