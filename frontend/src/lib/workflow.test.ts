import { describe, it, expectTypeOf, expect } from "vitest";
import type { WireWorkflowState } from "./workflow";

describe("WireWorkflowState", () => {
  it("accepts a fully-populated wire state object", () => {
    const state: WireWorkflowState = {
      reviewer: { open: true, ready: true, nameGuess: "my-app" },
      coordinator: {
        open: true,
        collected: true,
        appName: "my-app",
        envVarKeys: ["DATABASE_URL"],
        envVars: [{ key: "DATABASE_URL", maskedValue: "****" }],
      },
      deployer: {
        open: true,
        buildPack: "nixpacks",
        targetUrl: "https://example.com",
      },
    };
    expect(state.reviewer.ready).toBe(true);
    expect(state.coordinator.envVarKeys).toContain("DATABASE_URL");
    expect(state.deployer.buildPack).toBe("nixpacks");
  });

  it("accepts a minimal wire state with nulls", () => {
    const state: WireWorkflowState = {
      reviewer: { open: true, ready: false, nameGuess: null },
      coordinator: {
        open: false,
        collected: false,
        appName: null,
        envVarKeys: [],
        envVars: [],
      },
      deployer: { open: false, buildPack: null, targetUrl: null },
    };
    expect(state.coordinator.appName).toBeNull();
    expect(state.deployer.targetUrl).toBeNull();
    expectTypeOf(state.reviewer.open).toEqualTypeOf<true>();
  });
});
