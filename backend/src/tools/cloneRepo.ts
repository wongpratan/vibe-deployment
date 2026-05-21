import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { ToolContext } from "./deployment.js";

const HOST_ALLOWLIST = new Set([
  "github.com",
  "www.github.com",
  "gitlab.com",
  "www.gitlab.com",
  "bitbucket.org",
  "www.bitbucket.org",
  "codeberg.org",
  "www.codeberg.org",
]);

const CLONE_TIMEOUT_MS = 30_000;
const MAX_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 5_000;
const SNIPPET_BYTES = 64 * 1024;

const INTERESTING_FILES = [
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
  "package.json",
  "requirements.txt",
  "pyproject.toml",
  "Pipfile",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Gemfile",
  "composer.json",
  "deno.json",
  "index.html",
  ".nixpacks.toml",
];

const LOCKFILES = [
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "poetry.lock",
  "Cargo.lock",
  "Gemfile.lock",
  "composer.lock",
  "go.sum",
];

const SECRET_NAMES = new Set([".env", "id_rsa", "id_dsa", "id_ed25519", "id_ecdsa"]);
const SECRET_SUFFIXES = [".pem", ".key", ".p12", ".pfx"];

const ENV_EXAMPLE_FILES = [".env.example", ".env.sample", ".env.template"];
const ENV_VAR_NOISE = new Set([
  "NODE_ENV",
  "PORT",
  "PATH",
  "HOME",
  "CI",
  "PWD",
  "SHELL",
  "USER",
  "LANG",
  "TZ",
]);
const ENV_VAR_NOISE_PREFIXES = ["npm_", "VERCEL_", "NEXT_RUNTIME"];
const ENV_VAR_KEY_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const SCAN_SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  "vendor",
  "target",
  "out",
  ".venv",
  "venv",
  "__pycache__",
]);
const SCAN_SKIP_EXTS = new Set([
  ".lock",
  ".log",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".mp4",
  ".mov",
  ".wasm",
]);
const ENV_CODE_PATTERNS = [
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
  /process\.env\[\s*['"`]([A-Z][A-Z0-9_]*)['"`]\s*\]/g,
  /import\.meta\.env\.([A-Z][A-Z0-9_]*)/g,
  /os\.environ\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g,
  /os\.environ\.get\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
  /os\.getenv\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
  /\bENV\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g,
];
const PLACEHOLDER_VALUE_RE = /^(|""|''|changeme|change-me|todo|xxx+|<[^>]+>|your[-_].+|placeholder)$/i;

export type EnvVarDetected = {
  key: string;
  source: string;
  required: boolean;
  defaultValue?: string;
};

const PRIVATE_IP_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^::1$/,
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
];

function validateRepoUrl(input: unknown): { ok: true; url: URL } | { ok: false; reason: string } {
  if (typeof input !== "string" || input.length === 0) {
    return { ok: false, reason: "repoUrl must be a non-empty string" };
  }
  if (input.length > 2048) return { ok: false, reason: "repoUrl too long" };
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: "repoUrl not a valid URL" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: `protocol ${url.protocol} not allowed (https only)` };
  }
  const host = url.hostname.toLowerCase();
  for (const re of PRIVATE_IP_PATTERNS) {
    if (re.test(host)) return { ok: false, reason: `host ${host} is private/loopback` };
  }
  if (!HOST_ALLOWLIST.has(host)) {
    return { ok: false, reason: `host ${host} not in allowlist` };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "embedded credentials not allowed in repoUrl" };
  }
  return { ok: true, url };
}

function validateRef(input: unknown): string | null {
  if (input == null) return null;
  if (typeof input !== "string") return null;
  if (input.length === 0 || input.length > 200) return null;
  if (!/^[A-Za-z0-9._\-\/]+$/.test(input)) return null;
  if (input.startsWith("-")) return null;
  return input;
}

async function runGitClone(repoUrl: string, ref: string | null, dest: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const args = ["clone", "--depth", "1", "--single-branch"];
  if (ref) args.push("--branch", ref);
  args.push("--", repoUrl, dest);
  return await new Promise((resolve) => {
    const child = spawn("git", args, {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/bin/echo" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, CLONE_TIMEOUT_MS);
    child.stderr.on("data", (d) => {
      if (stderr.length < 4096) stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, reason: `git spawn failed: ${err.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killed) return resolve({ ok: false, reason: `clone timeout after ${CLONE_TIMEOUT_MS}ms` });
      if (code === 0) return resolve({ ok: true });
      resolve({ ok: false, reason: stderr.trim().slice(0, 500) || `git exited with code ${code}` });
    });
  });
}

async function walk(
  dir: string,
  caps: { bytes: number; files: number },
): Promise<{ ok: true; bytes: number; files: number } | { ok: false; reason: string }> {
  let bytes = 0;
  let files = 0;
  const stack: string[] = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (e.name === ".git") continue;
        stack.push(full);
      } else if (e.isFile()) {
        files++;
        if (files > caps.files) return { ok: false, reason: `file count exceeded ${caps.files}` };
        const st = await fs.stat(full);
        bytes += st.size;
        if (bytes > caps.bytes) return { ok: false, reason: `size exceeded ${caps.bytes} bytes` };
      }
    }
  }
  return { ok: true, bytes, files };
}

async function readSnippet(file: string): Promise<string> {
  const fh = await fs.open(file, "r");
  try {
    const buf = Buffer.alloc(SNIPPET_BYTES);
    const { bytesRead } = await fh.read(buf, 0, SNIPPET_BYTES, 0);
    return buf.slice(0, bytesRead).toString("utf8");
  } finally {
    await fh.close();
  }
}

function findSecrets(rootEntries: { name: string; isDir: boolean }[]): string[] {
  const found: string[] = [];
  for (const e of rootEntries) {
    if (e.isDir) continue;
    if (SECRET_NAMES.has(e.name)) found.push(e.name);
    else if (SECRET_SUFFIXES.some((s) => e.name.endsWith(s))) found.push(e.name);
  }
  return found;
}

function isNoiseKey(key: string): boolean {
  if (ENV_VAR_NOISE.has(key)) return true;
  return ENV_VAR_NOISE_PREFIXES.some((p) => key.startsWith(p));
}

function parseDotEnvExample(content: string, sourceFile: string): EnvVarDetected[] {
  const out: EnvVarDetected[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!ENV_VAR_KEY_RE.test(key)) continue;
    if (isNoiseKey(key)) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    const entry: EnvVarDetected = { key, source: `env.example:${sourceFile}`, required: true };
    if (PLACEHOLDER_VALUE_RE.test(value)) entry.defaultValue = value;
    out.push(entry);
  }
  return out;
}

async function scanEnvVars(root: string): Promise<EnvVarDetected[]> {
  const found = new Map<string, EnvVarDetected>();

  for (const name of ENV_EXAMPLE_FILES) {
    try {
      const text = await readSnippet(path.join(root, name));
      for (const v of parseDotEnvExample(text, name)) {
        if (!found.has(v.key)) found.set(v.key, v);
      }
    } catch {
      // file absent; ignore
    }
  }

  const stack: string[] = [root];
  let scanned = 0;
  const MAX_SCAN_FILES = 1500;
  while (stack.length && scanned < MAX_SCAN_FILES) {
    const current = stack.pop()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(current, e.name);
      if (e.isDirectory()) {
        if (SCAN_SKIP_DIRS.has(e.name)) continue;
        stack.push(full);
        continue;
      }
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (SCAN_SKIP_EXTS.has(ext)) continue;
      if (e.name.startsWith(".env")) continue;
      scanned++;
      let text: string;
      try {
        text = await readSnippet(full);
      } catch {
        continue;
      }
      const rel = path.relative(root, full);
      for (const re of ENV_CODE_PATTERNS) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          const key = m[1];
          if (!ENV_VAR_KEY_RE.test(key)) continue;
          if (isNoiseKey(key)) continue;
          if (!found.has(key)) {
            found.set(key, { key, source: `code:${rel}`, required: true });
          }
        }
      }
      if (scanned >= MAX_SCAN_FILES) break;
    }
  }

  return Array.from(found.values());
}

function lastUrlSegment(repoUrl: string): string {
  try {
    const u = new URL(repoUrl);
    const segs = u.pathname.split("/").filter(Boolean);
    let last = segs[segs.length - 1] ?? "";
    if (last.endsWith(".git")) last = last.slice(0, -4);
    return last || "app";
  } catch {
    return "app";
  }
}

function guessAppName(files: Record<string, string>, repoUrl: string): string {
  const pkg = files["package.json"];
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg);
      if (typeof parsed.name === "string" && parsed.name.trim()) {
        return String(parsed.name).replace(/^@[^/]+\//, "").trim();
      }
    } catch {
      // fall through
    }
  }
  const py = files["pyproject.toml"];
  if (py) {
    const m = py.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
    if (m) return m[1].trim();
  }
  return lastUrlSegment(repoUrl);
}

async function cleanup(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (err) {
    console.error(`[cloneRepo] cleanup failed for ${dir}:`, err);
  }
}

export const cloneAndInspectRepoTool = {
  schema: {
    type: "function" as const,
    function: {
      name: "clone_and_inspect_repo",
      description:
        "Shallow-clone a public git repo to the server, read root files needed for Coolify build-pack detection, scan the working tree for required environment variables, guess an application name, and return everything. Temp clone is deleted before returning. Use this as the primary source of truth for the Reviewer agent's build-pack decision and for downstream coordinator data (nameGuess, envVarsDetected).",
      parameters: {
        type: "object",
        required: ["repoUrl"],
        properties: {
          repoUrl: {
            type: "string",
            description: "HTTPS git URL on an allowed host (github.com, gitlab.com, bitbucket.org, codeberg.org).",
          },
          ref: {
            type: "string",
            description: "Optional branch or tag to clone. Defaults to repo HEAD.",
          },
        },
      },
    },
  },
  execute: async (args: any, _ctx: ToolContext): Promise<string> => {
    const v = validateRepoUrl(args?.repoUrl);
    if (!v.ok) return JSON.stringify({ clone_failed: true, reason: v.reason });
    const ref = validateRef(args?.ref);

    const dir = path.join(os.tmpdir(), "gpn-review-" + randomUUID());
    await fs.mkdir(dir, { recursive: true });

    try {
      const cloned = await runGitClone(v.url.toString(), ref, dir);
      if (!cloned.ok) {
        return JSON.stringify({ clone_failed: true, reason: cloned.reason });
      }

      const walked = await walk(dir, { bytes: MAX_BYTES, files: MAX_FILES });
      if (!walked.ok) {
        return JSON.stringify({ clone_failed: true, reason: walked.reason });
      }

      const rootDirents = await fs.readdir(dir, { withFileTypes: true });
      const rootEntries = rootDirents
        .filter((e) => e.name !== ".git")
        .map((e) => ({ name: e.name, isDir: e.isDirectory() }));

      const files: Record<string, string> = {};
      for (const name of INTERESTING_FILES) {
        const hit = rootEntries.find((e) => !e.isDir && e.name === name);
        if (hit) {
          try {
            files[name] = await readSnippet(path.join(dir, name));
          } catch (err) {
            files[name] = `<read error: ${String(err)}>`;
          }
        }
      }

      const lockfiles = LOCKFILES.filter((n) => rootEntries.some((e) => !e.isDir && e.name === n));
      const secretsFound = findSecrets(rootEntries);

      const envVarsDetected = await scanEnvVars(dir);
      const nameGuess = guessAppName(files, v.url.toString());

      return JSON.stringify({
        repoUrl: v.url.toString(),
        ref: ref ?? null,
        rootEntries,
        files,
        lockfiles,
        secretsFound,
        nameGuess,
        envVarsDetected,
        sizeBytes: walked.bytes,
        fileCount: walked.files,
      });
    } finally {
      await cleanup(dir);
    }
  },
};

export async function sweepStaleClones(): Promise<void> {
  const tmp = os.tmpdir();
  let entries: string[];
  try {
    entries = await fs.readdir(tmp);
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((n) => n.startsWith("gpn-review-"))
      .map((n) => cleanup(path.join(tmp, n))),
  );
}
