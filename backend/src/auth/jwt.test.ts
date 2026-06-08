import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import { sign, verify } from "./jwt.js";

describe("jwt", () => {
  it("round-trips payload through sign and verify", () => {
    const token = sign({ sub: "user-1", email: "a@example.com" });
    const decoded = verify(token);
    expect(decoded.sub).toBe("user-1");
    expect(decoded.email).toBe("a@example.com");
  });

  it("rejects a token signed with a different secret", () => {
    const foreign = jwt.sign({ sub: "x", email: "y@z" }, "some-other-secret-1234567");
    expect(() => verify(foreign)).toThrow();
  });

  it("rejects a malformed token", () => {
    expect(() => verify("not-a-jwt")).toThrow();
  });
});
