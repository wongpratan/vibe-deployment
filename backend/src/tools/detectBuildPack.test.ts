import { describe, it, expect } from "vitest";
import { detect, detectBuildPackTool } from "./detectBuildPack.js";
import type { ToolContext } from "./types.js";

const ctx = {} as ToolContext;

describe("detect — dockercompose", () => {
  it("uses compose candidates when provided and emits composePath only for a single candidate", () => {
    const multi = detect([], undefined, ["/docker-compose.yml", "/docker-compose.prod.yml"]);
    expect(multi.buildPack).toBe("dockercompose");
    expect(multi.composePath).toBeUndefined();
    expect(multi.ready).toBe(true);

    const single = detect([], undefined, ["/docker-compose.yml"]);
    expect(single.composePath).toBe("/docker-compose.yml");
  });

  it("falls back to scanning rootEntries for canonical compose filenames", () => {
    const r = detect(["compose.yaml", "src"]);
    expect(r.buildPack).toBe("dockercompose");
    expect(r.composeCandidates).toEqual(["/compose.yaml"]);
    expect(r.composePath).toBe("/compose.yaml");
  });
});

describe("detect — dockerfile", () => {
  it("picks dockerfile only when no compose candidates exist", () => {
    const r = detect(["Dockerfile"]);
    expect(r.buildPack).toBe("dockerfile");
    expect(r.dockerfilePath).toBe("/Dockerfile");
    expect(r.ready).toBe(true);
  });

  it("omits dockerfilePath when multiple Dockerfile candidates exist", () => {
    const r = detect([], undefined, undefined, ["/Dockerfile", "/Dockerfile.dev"]);
    expect(r.buildPack).toBe("dockerfile");
    expect(r.dockerfilePath).toBeUndefined();
  });
});

describe("detect — nixpacks node", () => {
  it("ready when scripts.start is present", () => {
    const r = detect(["package.json"], JSON.stringify({ scripts: { start: "node ." } }));
    expect(r.buildPack).toBe("nixpacks");
    expect(r.runtime).toBe("node");
    expect(r.ready).toBe(true);
  });

  it("ready when a known framework dep is present even without scripts.start", () => {
    const r = detect(["package.json"], JSON.stringify({ dependencies: { next: "14" } }));
    expect(r.ready).toBe(true);
    expect(r.notes.join("\n")).toContain('framework "next"');
  });

  it("not ready when no start and no framework", () => {
    const r = detect(["package.json"], JSON.stringify({}));
    expect(r.ready).toBe(false);
    expect(r.notes.join("\n")).toMatch(/no scripts.start/);
  });

  it("not ready when package.json is missing", () => {
    const r = detect(["package.json"]);
    expect(r.ready).toBe(false);
    expect(r.notes.join("\n")).toMatch(/packageJson not provided/);
  });

  it("not ready when package.json is invalid JSON", () => {
    const r = detect(["package.json"], "{not valid");
    expect(r.ready).toBe(false);
    expect(r.notes.join("\n")).toMatch(/not valid JSON/);
  });
});

describe("detect — other runtimes", () => {
  it("python: ready when a known entry file is present", () => {
    const r = detect(["requirements.txt", "main.py"]);
    expect(r.buildPack).toBe("nixpacks");
    expect(r.runtime).toBe("python");
    expect(r.ready).toBe(true);
  });

  it("python: not ready when no entry file present", () => {
    const r = detect(["pyproject.toml"]);
    expect(r.runtime).toBe("python");
    expect(r.ready).toBe(false);
  });

  it.each([
    [["go.mod"], "go"],
    [["Cargo.toml"], "rust"],
    [["pom.xml"], "java"],
    [["Gemfile"], "ruby"],
    [["composer.json"], "php"],
    [["deno.json"], "deno"],
    [["bun.lockb"], "bun"],
  ])("recognises %j as %s", (entries, runtime) => {
    const r = detect(entries as string[]);
    expect(r.buildPack).toBe("nixpacks");
    expect(r.runtime).toBe(runtime);
    expect(r.ready).toBe(true);
  });

  it("static when only index.html is present", () => {
    const r = detect(["index.html"]);
    expect(r.buildPack).toBe("static");
    expect(r.ready).toBe(true);
  });

  it("unknown when no rule matches", () => {
    const r = detect(["README.md"]);
    expect(r.buildPack).toBe("unknown");
    expect(r.ready).toBe(false);
    expect(r.matchedRule).toBe("no rule matched");
  });
});

describe("detect — secrets", () => {
  it("flags exact-name secrets and forces ready=false", () => {
    const r = detect(["Dockerfile", "id_rsa", "credentials.json"]);
    expect(r.secretsFound).toEqual(expect.arrayContaining(["id_rsa", "credentials.json"]));
    expect(r.ready).toBe(false);
    expect(r.notes.join("\n")).toMatch(/committed secrets force ready=false/);
  });

  it("flags pattern-matched secrets", () => {
    const r = detect(["server.pem", "private.key", "service-account-prod.json"]);
    expect(r.secretsFound).toEqual(
      expect.arrayContaining(["server.pem", "private.key", "service-account-prod.json"]),
    );
  });
});

describe("detectBuildPackTool.execute", () => {
  it("returns the JSON-stringified detect result for the supplied args", async () => {
    const out = await detectBuildPackTool.execute(
      { rootEntries: ["Dockerfile"] },
      ctx,
    );
    expect(JSON.parse(out)).toMatchObject({ buildPack: "dockerfile", ready: true });
  });

  it("tolerates missing/invalid args by defaulting to empty rootEntries", async () => {
    const out = await detectBuildPackTool.execute({}, ctx);
    expect(JSON.parse(out)).toMatchObject({ buildPack: "unknown", ready: false });
  });

  it("filters non-string entries from candidate arrays", async () => {
    const out = await detectBuildPackTool.execute(
      {
        rootEntries: [],
        composeCandidates: ["/docker-compose.yml", 42, null],
      },
      ctx,
    );
    expect(JSON.parse(out)).toMatchObject({
      buildPack: "dockercompose",
      composeCandidates: ["/docker-compose.yml"],
    });
  });
});
