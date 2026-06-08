import type { ToolContext } from "./types.js";

type BuildPack = "dockercompose" | "dockerfile" | "nixpacks" | "static" | "unknown";
type Runtime =
  | "node"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "ruby"
  | "php"
  | "deno"
  | "bun"
  | null;

const COMPOSE_FILES = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];

const NODE_FRAMEWORK_DEPS = ["next", "nuxt", "remix", "@remix-run/serve", "astro", "vite", "express", "fastify", "koa", "@nestjs/core"];

const PYTHON_ENTRY_FILES = ["main.py", "app.py", "manage.py", "wsgi.py", "asgi.py"];
const PYTHON_SERVER_DEPS = ["gunicorn", "uvicorn", "hypercorn", "daphne"];

const SECRET_EXACT = new Set(["id_rsa", "id_ed25519", "id_dsa", "id_ecdsa", "credentials.json"]);
const SECRET_PATTERNS: RegExp[] = [
  /\.pem$/,
  /\.key$/,
  /^service-account.*\.json$/,
  /^gcp-key.*\.json$/,
];

function scanSecrets(rootEntries: string[]): string[] {
  const found: string[] = [];
  for (const name of rootEntries) {
    if (SECRET_EXACT.has(name) || SECRET_PATTERNS.some((re) => re.test(name))) {
      found.push(name);
    }
  }
  return found;
}

function detectNodeReady(packageJson: string | undefined): { ready: boolean; notes: string[] } {
  const notes: string[] = [];
  if (!packageJson) {
    notes.push("packageJson not provided — could not verify scripts.start or framework deps");
    return { ready: false, notes };
  }
  let parsed: any;
  try {
    parsed = JSON.parse(packageJson);
  } catch {
    notes.push("package.json is not valid JSON");
    return { ready: false, notes };
  }
  const hasStart = !!parsed?.scripts?.start;
  const deps = { ...(parsed?.dependencies ?? {}), ...(parsed?.devDependencies ?? {}) };
  const framework = NODE_FRAMEWORK_DEPS.find((d) => d in deps);
  if (hasStart) return { ready: true, notes };
  if (framework) {
    notes.push(`no scripts.start, but framework "${framework}" detected — nixpacks may infer entry`);
    return { ready: true, notes };
  }
  notes.push("package.json has no scripts.start and no known framework dependency");
  return { ready: false, notes };
}

function detectPythonReady(rootEntries: string[]): { ready: boolean; notes: string[] } {
  const notes: string[] = [];
  const entry = PYTHON_ENTRY_FILES.find((f) => rootEntries.includes(f));
  if (entry) return { ready: true, notes };
  notes.push(`no clear python entry file (${PYTHON_ENTRY_FILES.join("/")}); check requirements for ${PYTHON_SERVER_DEPS.join("/")}`);
  return { ready: false, notes };
}

export function detect(
  rootEntries: string[],
  packageJson?: string,
  composeCandidates?: string[],
  dockerfileCandidates?: string[],
) {
  const entries = new Set(rootEntries);
  const secretsFound = scanSecrets(rootEntries);
  const notes: string[] = [];
  let buildPack: BuildPack = "unknown";
  let runtime: Runtime = null;
  let matchedRule = "no rule matched";
  let ready = false;
  let composePath: string | undefined;
  let dockerfilePath: string | undefined;

  const composeList =
    Array.isArray(composeCandidates) && composeCandidates.length > 0
      ? composeCandidates
      : COMPOSE_FILES.filter((f) => entries.has(f)).map((f) => `/${f}`);
  const dockerfileList =
    Array.isArray(dockerfileCandidates) && dockerfileCandidates.length > 0
      ? dockerfileCandidates
      : entries.has("Dockerfile")
        ? ["/Dockerfile"]
        : [];

  if (composeList.length > 0) {
    buildPack = "dockercompose";
    matchedRule = `${composeList.length} compose file(s) at repo root`;
    if (composeList.length === 1) composePath = composeList[0];
    ready = true;
  } else if (dockerfileList.length > 0) {
    buildPack = "dockerfile";
    matchedRule = `${dockerfileList.length} Dockerfile(s) at repo root, no compose`;
    if (dockerfileList.length === 1) dockerfilePath = dockerfileList[0];
    ready = true;
  } else if (entries.has("package.json")) {
    buildPack = "nixpacks";
    runtime = "node";
    matchedRule = "package.json present, no Docker";
    const r = detectNodeReady(packageJson);
    ready = r.ready;
    notes.push(...r.notes);
  } else if (["requirements.txt", "pyproject.toml", "Pipfile", "poetry.lock"].some((f) => entries.has(f))) {
    buildPack = "nixpacks";
    runtime = "python";
    matchedRule = "python manifest present, no Docker";
    const r = detectPythonReady(rootEntries);
    ready = r.ready;
    notes.push(...r.notes);
  } else if (entries.has("go.mod")) {
    buildPack = "nixpacks";
    runtime = "go";
    matchedRule = "go.mod present, no Docker";
    ready = true;
  } else if (entries.has("Cargo.toml")) {
    buildPack = "nixpacks";
    runtime = "rust";
    matchedRule = "Cargo.toml present, no Docker";
    ready = true;
  } else if (["pom.xml", "build.gradle", "build.gradle.kts"].some((f) => entries.has(f))) {
    buildPack = "nixpacks";
    runtime = "java";
    matchedRule = "java manifest present, no Docker";
    ready = true;
  } else if (entries.has("Gemfile")) {
    buildPack = "nixpacks";
    runtime = "ruby";
    matchedRule = "Gemfile present, no Docker";
    ready = true;
  } else if (entries.has("composer.json")) {
    buildPack = "nixpacks";
    runtime = "php";
    matchedRule = "composer.json present, no Docker";
    ready = true;
  } else if (entries.has("deno.json")) {
    buildPack = "nixpacks";
    runtime = "deno";
    matchedRule = "deno.json present, no Docker";
    ready = true;
  } else if (entries.has("bun.lockb")) {
    buildPack = "nixpacks";
    runtime = "bun";
    matchedRule = "bun.lockb present, no Docker";
    ready = true;
  } else if (entries.has("index.html")) {
    buildPack = "static";
    matchedRule = "root index.html present, no manifest, no Docker";
    ready = true;
  }

  if (secretsFound.length > 0) {
    ready = false;
    notes.push(`committed secrets force ready=false: ${secretsFound.join(", ")}`);
  }

  return {
    buildPack,
    runtime,
    matchedRule,
    ready,
    secretsFound,
    notes,
    composePath,
    dockerfilePath,
    composeCandidates: composeList,
    dockerfileCandidates: dockerfileList,
  };
}

export const detectBuildPackTool = {
  schema: {
    type: "function" as const,
    function: {
      name: "detect_build_pack",
      description:
        "Deterministically detect the Coolify build pack and scan for committed secrets from a repo's root file listing. Call after `clone_and_inspect_repo`. Pass `rootEntries` from the clone tool, `packageJson` when `package.json` is present, and `composeCandidates` / `dockerfileCandidates` from the clone tool so variants (e.g. docker-compose.prod.yml, Dockerfile.dev) are considered. Returns the build pack, runtime, the rule that matched, readiness, secrets, notes, `composeCandidates`, `dockerfileCandidates`, and (when exactly ONE candidate exists for the chosen pack) `composePath` / `dockerfilePath`. When more than one candidate exists, the corresponding `*Path` is omitted and the Reviewer must prompt the user to pick. Priority: dockercompose > dockerfile > nixpacks > static > unknown.",
      parameters: {
        type: "object",
        required: ["rootEntries"],
        properties: {
          rootEntries: {
            type: "array",
            items: { type: "string" },
            description: "Filenames at the repo root, exactly as returned by clone_and_inspect_repo.rootEntries.",
          },
          packageJson: {
            type: "string",
            description: "Raw package.json contents (from clone_and_inspect_repo.files['package.json']). Required to determine node readiness.",
          },
          composeCandidates: {
            type: "array",
            items: { type: "string" },
            description: "Leading-slash repo-root paths of compose files, verbatim from clone_and_inspect_repo.composeCandidates.",
          },
          dockerfileCandidates: {
            type: "array",
            items: { type: "string" },
            description: "Leading-slash repo-root paths of Dockerfiles, verbatim from clone_and_inspect_repo.dockerfileCandidates.",
          },
        },
      },
    },
  },
  execute: async (args: any, _ctx: ToolContext): Promise<string> => {
    const rootEntries: string[] = Array.isArray(args?.rootEntries) ? args.rootEntries : [];
    const packageJson: string | undefined = typeof args?.packageJson === "string" ? args.packageJson : undefined;
    const composeCandidates: string[] | undefined = Array.isArray(args?.composeCandidates)
      ? args.composeCandidates.filter((s: unknown): s is string => typeof s === "string")
      : undefined;
    const dockerfileCandidates: string[] | undefined = Array.isArray(args?.dockerfileCandidates)
      ? args.dockerfileCandidates.filter((s: unknown): s is string => typeof s === "string")
      : undefined;
    const result = detect(rootEntries, packageJson, composeCandidates, dockerfileCandidates);
    return JSON.stringify(result);
  },
};
