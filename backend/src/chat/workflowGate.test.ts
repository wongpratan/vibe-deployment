import { describe, it, expect } from "vitest";
import { makeWorkflowGate, toWireState, type WorkflowState } from "./workflowGate.js";
import type { ReviewRepository, ReviewResult } from "./review.repository.js";
import type { CoordinatorRepository, CoordinatorRequirements } from "./coordinator.repository.js";

function fakeReviews(latest: ReviewResult | null = null): ReviewRepository {
  return {
    findLatestReady: async () => latest,
    findLatestReadyForUser: async () => latest,
    deleteForChatAndUser: async () => {},
  };
}

function fakeCoordinators(latest: CoordinatorRequirements | null = null): CoordinatorRepository {
  return {
    findLatestCollected: async () => latest,
    deleteCoordinatorForChatAndUser: async () => {},
  };
}

function baseState(): WorkflowState {
  return {
    reviewer: {
      open: true,
      ready: false,
      nameGuess: null,
      repoUrl: null,
      gitBranch: null,
      buildPack: null,
      dockerComposeLocation: null,
      dockerfileLocation: null,
      envVarsDetected: [],
      summary: null,
    },
    coordinator: { open: false, collected: false, appName: null, envVars: [] },
    deployer: { open: false, targetUrl: null },
  };
}

describe("toWireState env var masking", () => {
  it("masks long values to last 4 chars, passes through short values, marks empty", () => {
    const s = baseState();
    s.coordinator.envVars = [
      { key: "API_KEY", value: "supersecret1234" },
      { key: "SHORT", value: "abc" },
      { key: "BLANK", value: "" },
    ];

    const wire = toWireState(s);

    expect(wire.coordinator.envVars).toEqual([
      { key: "API_KEY", maskedValue: "••••1234" },
      { key: "SHORT", maskedValue: "abc" },
      { key: "BLANK", maskedValue: "(empty)" },
    ]);
    expect(wire.coordinator.envVarKeys).toEqual(["API_KEY", "SHORT", "BLANK"]);
  });
});

describe("WorkflowGate systemContextPrompt — coordinator", () => {
  it("seeds coordinator with system prompt plus review context when review is ready", async () => {
    const review = {
      ready: true,
      repoUrl: "https://github.com/acme/app.git",
      buildPack: "dockerfile",
      nameGuess: "acme-app",
      envVarsDetected: [{ key: "FOO" }],
      summary: "Looks deployable.",
    } as unknown as ReviewResult;
    const gate = makeWorkflowGate({
      reviews: fakeReviews(review),
      coordinators: fakeCoordinators(null),
    });

    const msgs = await gate.systemContextPrompt("c1", "u1", "coordinator");

    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    const ctx = msgs[1].content as string;
    expect(ctx).toContain("repoUrl: https://github.com/acme/app.git");
    expect(ctx).toContain("buildPack: dockerfile");
    expect(ctx).toContain("nameGuess: acme-app");
    expect(ctx).toContain('envVarsDetected: [{"key":"FOO"}]');
    expect(ctx).toContain("reviewSummary: Looks deployable.");
  });

  it("returns only the agent system prompt when review is not ready", async () => {
    const gate = makeWorkflowGate({
      reviews: fakeReviews(null),
      coordinators: fakeCoordinators(null),
    });

    const msgs = await gate.systemContextPrompt("c1", "u1", "coordinator");

    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("system");
  });
});

describe("WorkflowGate targetUrl derivation", () => {
  it("builds targetUrl from appName and COOLIFY_APPS_DOMAIN when both present", async () => {
    const review = { ready: true } as unknown as ReviewResult;
    const coords = { appName: "acme-app", envVars: [] } as unknown as CoordinatorRequirements;
    const gate = makeWorkflowGate({
      reviews: fakeReviews(review),
      coordinators: fakeCoordinators(coords),
    });

    const s = await gate.state("c1", "u1");

    expect(s.deployer.targetUrl).toBe("https://acme-app.apps.test.example");
  });

  it("leaves targetUrl null when no coordinator requirements collected", async () => {
    const gate = makeWorkflowGate({
      reviews: fakeReviews(null),
      coordinators: fakeCoordinators(null),
    });

    const s = await gate.state("c1", "u1");

    expect(s.deployer.targetUrl).toBeNull();
  });
});

describe("WorkflowGate stage progression", () => {
  it("opens coordinator stage once a review is ready, deployer stays closed", async () => {
    const review = { ready: true, nameGuess: "myapp" } as unknown as ReviewResult;
    const gate = makeWorkflowGate({
      reviews: fakeReviews(review),
      coordinators: fakeCoordinators(null),
    });

    const s = await gate.state("chat-1", "user-1");

    expect(s.reviewer.open).toBe(true);
    expect(s.reviewer.ready).toBe(true);
    expect(s.coordinator.open).toBe(true);
    expect(s.coordinator.collected).toBe(false);
    expect(s.deployer.open).toBe(false);
  });

  it("leaves only the reviewer stage open when no review or requirements exist", async () => {
    const gate = makeWorkflowGate({
      reviews: fakeReviews(null),
      coordinators: fakeCoordinators(null),
    });

    const s = await gate.state("chat-1", "user-1");

    expect(s.reviewer.open).toBe(true);
    expect(s.reviewer.ready).toBe(false);
    expect(s.coordinator.open).toBe(false);
    expect(s.deployer.open).toBe(false);
  });

  it("opens deployer stage once coordinator requirements are collected", async () => {
    const review = { ready: true } as unknown as ReviewResult;
    const coords = {
      appName: "myapp",
      envVars: [],
    } as unknown as CoordinatorRequirements;
    const gate = makeWorkflowGate({
      reviews: fakeReviews(review),
      coordinators: fakeCoordinators(coords),
    });

    const s = await gate.state("chat-1", "user-1");

    expect(s.coordinator.collected).toBe(true);
    expect(s.deployer.open).toBe(true);
  });
});

describe("WorkflowGate.isOpen", () => {
  it("returns the open flag for the requested stage", async () => {
    const review = { ready: true } as unknown as ReviewResult;
    const gate = makeWorkflowGate({
      reviews: fakeReviews(review),
      coordinators: fakeCoordinators(null),
    });

    expect(await gate.isOpen("c1", "u1", "reviewer")).toBe(true);
    expect(await gate.isOpen("c1", "u1", "coordinator")).toBe(true);
    expect(await gate.isOpen("c1", "u1", "deployer")).toBe(false);
  });
});

describe("WorkflowGate envVars normalization", () => {
  it("ignores non-array envVars and entries missing a key", async () => {
    const review = { ready: true } as unknown as ReviewResult;
    const coords = {
      appName: "myapp",
      envVars: [
        { key: "OK", value: "v" },
        { key: "", value: "blank-key" },
        { value: "no-key" },
        { key: "NO_VAL" },
      ],
    } as unknown as CoordinatorRequirements;
    const gate = makeWorkflowGate({
      reviews: fakeReviews(review),
      coordinators: fakeCoordinators(coords),
    });

    const s = await gate.state("c1", "u1");

    expect(s.coordinator.envVars).toEqual([
      { key: "OK", value: "v" },
      { key: "NO_VAL", value: "" },
    ]);
  });

  it("treats non-array envVars as empty", async () => {
    const review = { ready: true } as unknown as ReviewResult;
    const coords = {
      appName: "myapp",
      envVars: "not-an-array",
    } as unknown as CoordinatorRequirements;
    const gate = makeWorkflowGate({
      reviews: fakeReviews(review),
      coordinators: fakeCoordinators(coords),
    });

    const s = await gate.state("c1", "u1");

    expect(s.coordinator.envVars).toEqual([]);
  });
});

describe("WorkflowGate systemContextPrompt — deployer", () => {
  it("includes only the agent system prompt when requirements not collected", async () => {
    const gate = makeWorkflowGate({
      reviews: fakeReviews({ ready: true } as unknown as ReviewResult),
      coordinators: fakeCoordinators(null),
    });

    const msgs = await gate.systemContextPrompt("c1", "u1", "deployer");

    expect(msgs).toHaveLength(1);
  });

  it("adds dockerComposeLocation line for dockercompose buildpack and includes coolify domain", async () => {
    const review = {
      ready: true,
      repoUrl: "https://github.com/acme/app.git",
      gitBranch: "main",
      buildPack: "dockercompose",
      dockerComposeLocation: "./docker-compose.yml",
    } as unknown as ReviewResult;
    const coords = {
      appName: "acme-app",
      envVars: [{ key: "API_KEY", value: "v" }],
    } as unknown as CoordinatorRequirements;
    const gate = makeWorkflowGate({
      reviews: fakeReviews(review),
      coordinators: fakeCoordinators(coords),
    });

    const msgs = await gate.systemContextPrompt("c1", "u1", "deployer");
    const ctx = msgs[1].content as string;

    expect(ctx).toContain("buildPack: dockercompose");
    expect(ctx).toContain("repoUrl: https://github.com/acme/app.git");
    expect(ctx).toContain("gitBranch: main");
    expect(ctx).toContain("dockerComposeLocation: ./docker-compose.yml");
    expect(ctx).not.toContain("dockerfileLocation");
    expect(ctx).toContain("appName: acme-app");
    expect(ctx).toContain('envVarKeys: ["API_KEY"]');
    expect(ctx).toContain("coolifyAppsDomain: apps.test.example");
    expect(ctx).toContain("expectedAppUrl: https://acme-app.apps.test.example");
  });

  it("adds dockerfileLocation line for dockerfile buildpack with placeholder when missing", async () => {
    const review = {
      ready: true,
      buildPack: "dockerfile",
    } as unknown as ReviewResult;
    const coords = {
      appName: "acme-app",
      envVars: [],
    } as unknown as CoordinatorRequirements;
    const gate = makeWorkflowGate({
      reviews: fakeReviews(review),
      coordinators: fakeCoordinators(coords),
    });

    const msgs = await gate.systemContextPrompt("c1", "u1", "deployer");
    const ctx = msgs[1].content as string;

    expect(ctx).toContain("buildPack: dockerfile");
    expect(ctx).toContain("dockerfileLocation: (not set)");
    expect(ctx).not.toContain("dockerComposeLocation");
  });

  it("prompts to ask the user when gitBranch is missing", async () => {
    const review = { ready: true, buildPack: "nixpacks" } as unknown as ReviewResult;
    const coords = {
      appName: "acme-app",
      envVars: [],
    } as unknown as CoordinatorRequirements;
    const gate = makeWorkflowGate({
      reviews: fakeReviews(review),
      coordinators: fakeCoordinators(coords),
    });

    const msgs = await gate.systemContextPrompt("c1", "u1", "deployer");
    const ctx = msgs[1].content as string;

    expect(ctx).toContain("gitBranch: unknown — ask the user what branch to deploy from");
  });
});

describe("WorkflowGate systemContextPrompt — reviewer", () => {
  it("returns only the agent system prompt for the reviewer agent", async () => {
    const gate = makeWorkflowGate({
      reviews: fakeReviews({ ready: true } as unknown as ReviewResult),
      coordinators: fakeCoordinators({ appName: "x", envVars: [] } as unknown as CoordinatorRequirements),
    });

    const msgs = await gate.systemContextPrompt("c1", "u1", "reviewer");

    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("system");
  });
});
