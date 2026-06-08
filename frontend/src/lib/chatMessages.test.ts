import { describe, it, expect } from "vitest";
import {
  coordinatorAppNameInput,
  coordinatorGreeting,
  deployerGreeting,
  unwrapUserPayload,
} from "./chatMessages";

describe("unwrapUserPayload", () => {
  it("returns the input unchanged when no wrapper matches", () => {
    expect(unwrapUserPayload("hello world")).toBe("hello world");
  });

  it('strips the `My <field> is "<value>".` wrapper', () => {
    expect(
      unwrapUserPayload('My git repo URL is "https://github.com/a/b.git".'),
    ).toBe("https://github.com/a/b.git");
  });

  it('strips the `Answer to "<label>": <value>` wrapper', () => {
    expect(
      unwrapUserPayload('Answer to "Application name?": my-cool-app'),
    ).toBe("my-cool-app");
  });

  it("masks envVars JSON inside a wrapper as a key list", () => {
    const payload = JSON.stringify({
      envVars: [{ key: "API_KEY", value: "x" }, { key: "DB_URL", value: "y" }],
    });
    expect(unwrapUserPayload(`My env vars is "${payload}".`)).toBe(
      "Env vars set: API_KEY, DB_URL",
    );
  });

  it("reports empty envVars as `Env vars: (none)`", () => {
    const payload = JSON.stringify({ envVars: [] });
    expect(unwrapUserPayload(`My env vars is "${payload}".`)).toBe(
      "Env vars: (none)",
    );
  });

  it("falls back to the raw wrapped value when masking JSON fails", () => {
    expect(unwrapUserPayload('My note is "not json at all".')).toBe(
      "not json at all",
    );
  });
});

describe("coordinatorGreeting", () => {
  it("produces an assistant message without a name suggestion when nameGuess is null", () => {
    const msg = coordinatorGreeting(null);
    expect(msg.role).toBe("assistant");
    expect(msg.content).toContain("Coordinator");
    expect(msg.content).not.toContain("suggested");
  });

  it("mentions the suggested name when nameGuess is provided", () => {
    const msg = coordinatorGreeting("my-app");
    expect(msg.content).toContain("**my-app**");
    expect(msg.content).toContain("suggested");
  });
});

describe("coordinatorAppNameInput", () => {
  it("populates defaultValue from the name guess", () => {
    const req = coordinatorAppNameInput("guessed-name");
    expect(req.inputType).toBe("text");
    expect(req.required).toBe(true);
    expect(req.defaultValue).toBe("guessed-name");
  });

  it("leaves defaultValue undefined when no name guess is given", () => {
    expect(coordinatorAppNameInput(null).defaultValue).toBeUndefined();
  });
});

describe("deployerGreeting", () => {
  const fullCtx = {
    collected: true,
    appName: "my-app",
    envVarKeys: ["API_KEY"],
    envVars: [{ key: "API_KEY", maskedValue: "••••" }],
    buildPack: "nixpacks",
    targetUrl: "https://app.example.com",
  };

  it("returns a simple greeting when context is null", () => {
    const msg = deployerGreeting(null);
    expect(msg.content).toContain("Deployer");
    expect(msg.content).not.toContain("Build Pack");
  });

  it("renders a markdown summary when context is collected", () => {
    const msg = deployerGreeting(fullCtx);
    expect(msg.content).toContain("**Build Pack:** nixpacks");
    expect(msg.content).toContain("**Application Name:** my-app");
    expect(msg.content).toContain("**Target URL:** <https://app.example.com>");
    expect(msg.content).toContain("| `API_KEY` | `••••` |");
  });

  it("shows `none` instead of an env-var table when envVars is empty", () => {
    const msg = deployerGreeting({ ...fullCtx, envVars: [] });
    expect(msg.content).toContain("**Environment Variables:** none");
    expect(msg.content).not.toContain("| Key | Value |");
  });

  it("omits the Target URL line when targetUrl is null", () => {
    const msg = deployerGreeting({ ...fullCtx, targetUrl: null });
    expect(msg.content).not.toContain("Target URL");
  });
});
