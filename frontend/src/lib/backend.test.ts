import { describe, it, expect } from "vitest";
import { AUTH_COOKIE, BACKEND_URL } from "./backend";

describe("backend constants", () => {
  it("exposes auth cookie name", () => {
    expect(AUTH_COOKIE).toBe("auth_token");
  });

  it("provides a backend URL", () => {
    expect(typeof BACKEND_URL).toBe("string");
    expect(BACKEND_URL.length).toBeGreaterThan(0);
  });
});
