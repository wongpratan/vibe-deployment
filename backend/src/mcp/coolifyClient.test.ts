import { describe, it, expect, vi, beforeEach } from "vitest";

const { ClientCtor, TransportCtor, connect, listTools, callTool, envState } = vi.hoisted(() => ({
  ClientCtor: vi.fn(),
  TransportCtor: vi.fn(),
  connect: vi.fn(async () => {}),
  listTools: vi.fn(),
  callTool: vi.fn(),
  envState: {
    env: {
      COOLIFY_BASE_URL: "https://coolify.test" as string | undefined,
      COOLIFY_ACCESS_TOKEN: "tkn" as string | undefined,
    },
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    constructor(...args: unknown[]) {
      ClientCtor(...args);
    }
    connect = connect;
    listTools = listTools;
    callTool = callTool;
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class {
    constructor(...args: unknown[]) {
      TransportCtor(...args);
    }
  },
}));

vi.mock("../env.js", () => envState);

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  envState.env = {
    COOLIFY_BASE_URL: "https://coolify.test",
    COOLIFY_ACCESS_TOKEN: "tkn",
  };
});

describe("isCoolifyToolName", () => {
  it("matches names prefixed with coolify_", async () => {
    const mod = await import("./coolifyClient.js");
    expect(mod.isCoolifyToolName("coolify_deploy")).toBe(true);
    expect(mod.isCoolifyToolName("save_review_result")).toBe(false);
  });
});

describe("getCoolifyTools — no creds", () => {
  it("returns [] and warns once when env is missing", async () => {
    envState.env = { COOLIFY_BASE_URL: undefined, COOLIFY_ACCESS_TOKEN: undefined };
    vi.resetModules();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("./coolifyClient.js");

    expect(await mod.getCoolifyTools()).toEqual([]);
    expect(await mod.getCoolifyTools()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
  });
});

describe("getCoolifyTools — with creds", () => {
  it("returns aliased and sanitized OpenAI-shaped schemas", async () => {
    listTools.mockResolvedValueOnce({
      tools: [
        {
          name: "deploy@v1",
          description: "Deploy stuff",
          inputSchema: { type: "object", properties: { uuid: { type: "string" } } },
        },
        { name: "noschema" },
      ],
    });
    const mod = await import("./coolifyClient.js");

    const tools = await mod.getCoolifyTools();

    expect(tools).toHaveLength(2);
    expect(tools[0].function.name).toBe("coolify_deploy_v1");
    expect(tools[0].function.description).toBe("Deploy stuff");
    expect(tools[1].function.name).toBe("coolify_noschema");
    expect(tools[1].function.description).toBe("noschema");
    expect(tools[1].function.parameters).toEqual({ type: "object", properties: {} });
  });

  it("caches the schemas after first call", async () => {
    listTools.mockResolvedValueOnce({ tools: [{ name: "x" }] });
    const mod = await import("./coolifyClient.js");

    await mod.getCoolifyTools();
    await mod.getCoolifyTools();

    expect(listTools).toHaveBeenCalledTimes(1);
  });

  it("returns [] and logs when listTools throws", async () => {
    listTools.mockRejectedValueOnce(new Error("mcp down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = await import("./coolifyClient.js");

    expect(await mod.getCoolifyTools()).toEqual([]);
    expect(err).toHaveBeenCalled();

    err.mockRestore();
  });
});

describe("dispatchCoolifyTool", () => {
  it("returns env-not-configured when creds missing", async () => {
    envState.env = { COOLIFY_BASE_URL: undefined, COOLIFY_ACCESS_TOKEN: undefined };
    vi.resetModules();
    const mod = await import("./coolifyClient.js");
    const out = await mod.dispatchCoolifyTool("coolify_deploy", "{}");
    expect(JSON.parse(out)).toEqual({ error: "Coolify env not configured" });
  });

  it("returns 'unknown coolify tool' when the alias has not been registered", async () => {
    const mod = await import("./coolifyClient.js");
    const out = await mod.dispatchCoolifyTool("coolify_mystery", "{}");
    expect(JSON.parse(out)).toEqual({ error: "unknown coolify tool: coolify_mystery" });
  });

  it("returns 'invalid JSON arguments' when rawArgs cannot be parsed", async () => {
    listTools.mockResolvedValueOnce({ tools: [{ name: "deploy" }] });
    const mod = await import("./coolifyClient.js");
    await mod.getCoolifyTools();

    const out = await mod.dispatchCoolifyTool("coolify_deploy", "not-json");
    expect(JSON.parse(out)).toEqual({ error: "invalid JSON arguments" });
  });

  it("calls the underlying tool with the parsed args and returns its content", async () => {
    listTools.mockResolvedValueOnce({ tools: [{ name: "deploy" }] });
    callTool.mockResolvedValueOnce({ content: { ok: true } });
    const mod = await import("./coolifyClient.js");
    await mod.getCoolifyTools();

    const out = await mod.dispatchCoolifyTool("coolify_deploy", '{"uuid":"u"}');

    expect(callTool).toHaveBeenCalledWith({ name: "deploy", arguments: { uuid: "u" } });
    expect(JSON.parse(out)).toEqual({ ok: true });
  });

  it("wraps thrown errors from the MCP call as JSON error strings", async () => {
    listTools.mockResolvedValueOnce({ tools: [{ name: "deploy" }] });
    callTool.mockRejectedValueOnce(new Error("boom"));
    const mod = await import("./coolifyClient.js");
    await mod.getCoolifyTools();

    const out = await mod.dispatchCoolifyTool("coolify_deploy", "{}");
    expect(JSON.parse(out).error).toContain("boom");
  });

  it("treats empty rawArgs as no arguments", async () => {
    listTools.mockResolvedValueOnce({ tools: [{ name: "deploy" }] });
    callTool.mockResolvedValueOnce({ content: { ok: 1 } });
    const mod = await import("./coolifyClient.js");
    await mod.getCoolifyTools();

    await mod.dispatchCoolifyTool("coolify_deploy", "");

    expect(callTool).toHaveBeenCalledWith({ name: "deploy", arguments: {} });
  });
});

describe("callCoolifyToolByOriginalName", () => {
  it("returns res.content stringified when present", async () => {
    callTool.mockResolvedValueOnce({ content: [{ type: "text", text: "hi" }] });
    const mod = await import("./coolifyClient.js");

    const out = await mod.callCoolifyToolByOriginalName("deploy", { uuid: "u" });

    expect(JSON.parse(out)).toEqual([{ type: "text", text: "hi" }]);
    expect(callTool).toHaveBeenCalledWith({ name: "deploy", arguments: { uuid: "u" } });
  });

  it("falls back to stringifying the whole response when content is absent", async () => {
    callTool.mockResolvedValueOnce({ ok: true });
    const mod = await import("./coolifyClient.js");

    const out = await mod.callCoolifyToolByOriginalName("deploy", {});

    expect(JSON.parse(out)).toEqual({ ok: true });
  });
});
