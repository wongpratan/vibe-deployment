import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  cloneAndInspectRepoTool,
  findSecrets,
  guessAppName,
  parseDotEnvExample,
  scanEnvVars,
  validateRef,
  walk,
} from "./cloneRepo.js";
import type { ToolContext } from "./types.js";

async function makeTmpDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), "gpn-clonerepo-test-" + randomUUID());
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function writeFile(root: string, rel: string, content: string): Promise<void> {
  const full = path.join(root, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf8");
}

const ctx = {} as ToolContext;

describe("cloneAndInspectRepoTool — repoUrl validation", () => {
  it("rejects non-string repoUrl", async () => {
    const out = await cloneAndInspectRepoTool.execute({ repoUrl: null }, ctx);
    expect(JSON.parse(out)).toEqual({
      clone_failed: true,
      reason: "repoUrl must be a non-empty string",
    });
  });

  it("rejects empty string", async () => {
    const out = await cloneAndInspectRepoTool.execute({ repoUrl: "" }, ctx);
    expect(JSON.parse(out)).toEqual({
      clone_failed: true,
      reason: "repoUrl must be a non-empty string",
    });
  });

  it("rejects an overly long URL", async () => {
    const out = await cloneAndInspectRepoTool.execute(
      { repoUrl: "https://github.com/x/" + "a".repeat(3000) },
      ctx,
    );
    expect(JSON.parse(out).reason).toBe("repoUrl too long");
  });

  it("rejects an unparseable URL", async () => {
    const out = await cloneAndInspectRepoTool.execute({ repoUrl: "::not a url" }, ctx);
    expect(JSON.parse(out).reason).toBe("repoUrl not a valid URL");
  });

  it("rejects non-http(s) protocols", async () => {
    const out = await cloneAndInspectRepoTool.execute(
      { repoUrl: "ftp://github.com/acme/app" },
      ctx,
    );
    expect(JSON.parse(out).reason).toContain("not allowed (https only)");
  });

  it.each([
    "http://localhost/acme/app",
    "http://127.0.0.1/acme/app",
    "http://10.0.0.1/acme/app",
    "http://192.168.1.1/acme/app",
    "http://172.16.0.1/acme/app",
    "http://169.254.0.1/acme/app",
  ])("rejects private/loopback host %s", async (url) => {
    const out = await cloneAndInspectRepoTool.execute({ repoUrl: url }, ctx);
    expect(JSON.parse(out).reason).toContain("private/loopback");
  });

  it("rejects hosts not in the allowlist", async () => {
    const out = await cloneAndInspectRepoTool.execute(
      { repoUrl: "https://evil.example.com/acme/app" },
      ctx,
    );
    expect(JSON.parse(out).reason).toContain("not in allowlist");
  });

  it("rejects URLs containing embedded credentials", async () => {
    const out = await cloneAndInspectRepoTool.execute(
      { repoUrl: "https://user:pw@github.com/acme/app" },
      ctx,
    );
    expect(JSON.parse(out).reason).toBe("embedded credentials not allowed in repoUrl");
  });
});

describe("validateRef", () => {
  it("returns null for null/undefined", () => {
    expect(validateRef(null)).toBeNull();
    expect(validateRef(undefined)).toBeNull();
  });

  it("returns null for non-strings", () => {
    expect(validateRef(42)).toBeNull();
    expect(validateRef({})).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(validateRef("")).toBeNull();
  });

  it("returns null for refs longer than 200 chars", () => {
    expect(validateRef("a".repeat(201))).toBeNull();
  });

  it("returns null for refs starting with a dash (option-injection guard)", () => {
    expect(validateRef("-upload-pack=evil")).toBeNull();
  });

  it("returns null for refs containing disallowed characters", () => {
    expect(validateRef("feat/foo bar")).toBeNull();
    expect(validateRef("feat;rm -rf")).toBeNull();
    expect(validateRef("héllo")).toBeNull();
  });

  it("accepts plain branch and tag names", () => {
    expect(validateRef("main")).toBe("main");
    expect(validateRef("v1.2.3")).toBe("v1.2.3");
    expect(validateRef("release/2024-01")).toBe("release/2024-01");
    expect(validateRef("feature_x.test-1")).toBe("feature_x.test-1");
  });
});

describe("parseDotEnvExample", () => {
  it("returns an empty array for empty input", () => {
    expect(parseDotEnvExample("", ".env.example")).toEqual([]);
  });

  it("ignores blank lines and comments", () => {
    const out = parseDotEnvExample("\n# a comment\n   \n", ".env.example");
    expect(out).toEqual([]);
  });

  it("parses a simple KEY=value as required and tags source", () => {
    const out = parseDotEnvExample("DATABASE_URL=postgres://x", ".env.example");
    expect(out).toEqual([
      { key: "DATABASE_URL", source: "env.example:.env.example", required: true },
    ]);
  });

  it("strips matching surrounding double and single quotes", () => {
    const dq = parseDotEnvExample('FOO="bar"', ".env.example");
    const sq = parseDotEnvExample("FOO='bar'", ".env.example");
    expect(dq[0]).toMatchObject({ key: "FOO" });
    expect(sq[0]).toMatchObject({ key: "FOO" });
    expect(dq[0].defaultValue).toBeUndefined();
    expect(sq[0].defaultValue).toBeUndefined();
  });

  it("records placeholder values as defaultValue", () => {
    const out = parseDotEnvExample(
      [
        "EMPTY=",
        'EMPTY_DQ=""',
        "CHANGEME=changeme",
        "TODO=todo",
        "ANGLE=<your-token>",
        "YOUR=your-secret",
      ].join("\n"),
      ".env.example",
    );
    const byKey = Object.fromEntries(out.map((e) => [e.key, e.defaultValue]));
    expect(byKey.EMPTY).toBe("");
    expect(byKey.EMPTY_DQ).toBe("");
    expect(byKey.CHANGEME).toBe("changeme");
    expect(byKey.TODO).toBe("todo");
    expect(byKey.ANGLE).toBe("<your-token>");
    expect(byKey.YOUR).toBe("your-secret");
  });

  it("does not record real values as defaultValue", () => {
    const out = parseDotEnvExample("API_URL=https://api.example.com", ".env.example");
    expect(out[0].defaultValue).toBeUndefined();
  });

  it("filters out noise keys (NODE_ENV, PORT, npm_*, VERCEL_*)", () => {
    const out = parseDotEnvExample(
      ["NODE_ENV=production", "PORT=3000", "npm_package_name=x", "VERCEL_URL=y", "REAL=1"].join("\n"),
      ".env.example",
    );
    expect(out.map((e) => e.key)).toEqual(["REAL"]);
  });

  it("rejects keys that fail the screaming-snake regex", () => {
    const out = parseDotEnvExample(
      ["lowercase=1", "1STARTS_WITH_DIGIT=1", "HAS-DASH=1", "OK_KEY=1"].join("\n"),
      ".env.example",
    );
    expect(out.map((e) => e.key)).toEqual(["OK_KEY"]);
  });

  it("skips malformed lines without an `=`", () => {
    const out = parseDotEnvExample("JUST_A_KEY\n=NOKEY", ".env.example");
    expect(out).toEqual([]);
  });
});

describe("guessAppName", () => {
  it("prefers the package.json name field", () => {
    const files = { "package.json": JSON.stringify({ name: "my-app" }) };
    expect(guessAppName(files, "https://github.com/acme/repo.git")).toBe("my-app");
  });

  it("strips an npm scope prefix from package.json names", () => {
    const files = { "package.json": JSON.stringify({ name: "@acme/widgets" }) };
    expect(guessAppName(files, "https://github.com/acme/repo")).toBe("widgets");
  });

  it("falls back to the URL segment when package.json has no name", () => {
    const files = { "package.json": JSON.stringify({ version: "1.0.0" }) };
    expect(guessAppName(files, "https://github.com/acme/my-repo.git")).toBe("my-repo");
  });

  it("falls back to the URL segment when package.json is malformed", () => {
    const files = { "package.json": "{ not json" };
    expect(guessAppName(files, "https://github.com/acme/repo")).toBe("repo");
  });

  it("uses pyproject.toml name when no package.json is present", () => {
    const files = { "pyproject.toml": '[project]\nname = "py-thing"\n' };
    expect(guessAppName(files, "https://github.com/acme/fallback")).toBe("py-thing");
  });

  it("returns the URL segment with the trailing .git stripped when no manifest is recognized", () => {
    expect(guessAppName({}, "https://github.com/acme/my-repo.git")).toBe("my-repo");
  });

  it("returns 'app' for URLs with no usable path segment", () => {
    expect(guessAppName({}, "https://github.com/")).toBe("app");
  });
});

describe("findSecrets", () => {
  it("returns empty when no suspicious files are present", () => {
    expect(
      findSecrets([
        { name: "README.md", isDir: false },
        { name: "src", isDir: true },
      ]),
    ).toEqual([]);
  });

  it("flags well-known dotfiles by exact name", () => {
    expect(
      findSecrets([
        { name: ".env", isDir: false },
        { name: "id_rsa", isDir: false },
        { name: "id_ed25519", isDir: false },
      ]),
    ).toEqual([".env", "id_rsa", "id_ed25519"]);
  });

  it("flags files by suspicious suffix", () => {
    expect(
      findSecrets([
        { name: "server.pem", isDir: false },
        { name: "client.key", isDir: false },
        { name: "cert.p12", isDir: false },
        { name: "store.pfx", isDir: false },
      ]),
    ).toEqual(["server.pem", "client.key", "cert.p12", "store.pfx"]);
  });

  it("ignores directories even when named like secrets", () => {
    expect(findSecrets([{ name: ".env", isDir: true }])).toEqual([]);
  });
});

describe("walk", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await makeTmpDir();
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("counts files and bytes across nested directories", async () => {
    await writeFile(dir, "a.txt", "hello");
    await writeFile(dir, "sub/b.txt", "world!");
    const result = await walk(dir, { bytes: 1_000_000, files: 1000 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.files).toBe(2);
      expect(result.bytes).toBe(11);
    }
  });

  it("skips the .git directory", async () => {
    await writeFile(dir, "a.txt", "x");
    await writeFile(dir, ".git/objects/pack/big", "y".repeat(10000));
    const result = await walk(dir, { bytes: 1_000_000, files: 1000 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.files).toBe(1);
  });

  it("fails when the file count cap is exceeded", async () => {
    for (let i = 0; i < 5; i++) await writeFile(dir, `f${i}.txt`, "x");
    const result = await walk(dir, { bytes: 1_000_000, files: 3 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("file count exceeded 3");
  });

  it("fails when the byte cap is exceeded", async () => {
    await writeFile(dir, "big.bin", "x".repeat(2000));
    const result = await walk(dir, { bytes: 500, files: 1000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("size exceeded 500 bytes");
  });
});

describe("scanEnvVars", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await makeTmpDir();
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("returns an empty list for a repo with nothing interesting", async () => {
    await writeFile(dir, "README.md", "# hi");
    const out = await scanEnvVars(dir);
    expect(out).toEqual([]);
  });

  it("picks up variables declared in .env.example with source tag", async () => {
    await writeFile(dir, ".env.example", "DATABASE_URL=postgres://x\nSTRIPE_KEY=changeme\n");
    const out = await scanEnvVars(dir);
    const byKey = Object.fromEntries(out.map((e) => [e.key, e]));
    expect(byKey.DATABASE_URL.source).toBe("env.example:.env.example");
    expect(byKey.STRIPE_KEY.defaultValue).toBe("changeme");
  });

  it("detects process.env.X references in source code", async () => {
    await writeFile(dir, "src/app.ts", "const k = process.env.SECRET_TOKEN;\n");
    const out = await scanEnvVars(dir);
    const keys = out.map((e) => e.key);
    expect(keys).toContain("SECRET_TOKEN");
    const entry = out.find((e) => e.key === "SECRET_TOKEN")!;
    expect(entry.source).toMatch(/^code:/);
    expect(entry.source).toContain("app.ts");
  });

  it("detects os.environ and os.getenv references in Python code", async () => {
    await writeFile(dir, "main.py", "import os\nos.environ['PY_KEY']\nos.getenv('OTHER_KEY')\n");
    const out = await scanEnvVars(dir);
    const keys = out.map((e) => e.key);
    expect(keys).toContain("PY_KEY");
    expect(keys).toContain("OTHER_KEY");
  });

  it("prefers .env.example as the source when a key appears in both", async () => {
    await writeFile(dir, ".env.example", "SHARED=foo\n");
    await writeFile(dir, "src/app.ts", "process.env.SHARED;\n");
    const out = await scanEnvVars(dir);
    const shared = out.find((e) => e.key === "SHARED");
    expect(shared?.source).toBe("env.example:.env.example");
  });

  it("does not scan inside skipped directories like node_modules", async () => {
    await writeFile(dir, "node_modules/pkg/index.js", "process.env.LEAKED_KEY;\n");
    await writeFile(dir, "src/app.ts", "process.env.REAL_KEY;\n");
    const out = await scanEnvVars(dir);
    const keys = out.map((e) => e.key);
    expect(keys).toContain("REAL_KEY");
    expect(keys).not.toContain("LEAKED_KEY");
  });

  it("filters out noise keys discovered in code", async () => {
    await writeFile(dir, "src/app.ts", "process.env.NODE_ENV; process.env.PORT; process.env.REAL;\n");
    const out = await scanEnvVars(dir);
    const keys = out.map((e) => e.key);
    expect(keys).toEqual(["REAL"]);
  });
});
