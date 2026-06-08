import { describe, it, expect } from "vitest";
import { customTool } from "./custom.js";

describe("customTool current_time", () => {
  it("returns a server time string for the requested timezone", async () => {
    const out = await customTool.execute({ timezone: "UTC" });
    const parsed = JSON.parse(out);
    expect(parsed.timezone).toBe("UTC");
    expect(parsed.time).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("defaults timezone to UTC when not given", async () => {
    const out = await customTool.execute({});
    expect(JSON.parse(out).timezone).toBe("UTC");
  });

  it("returns an error for an invalid timezone", async () => {
    const out = await customTool.execute({ timezone: "Not/AReal_Zone" });
    expect(JSON.parse(out)).toEqual({ error: "invalid timezone: Not/AReal_Zone" });
  });
});
