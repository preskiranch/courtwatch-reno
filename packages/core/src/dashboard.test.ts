import { describe, expect, it } from "vitest";
import { buildDashboard } from "./dashboard.js";
import { seedSnapshot } from "./seed-data.js";

describe("dashboard response", () => {
  it("returns watched program summaries and a next game", () => {
    const dashboard = buildDashboard(seedSnapshot, new Date("2026-05-23T20:00:00.000Z"));
    expect(dashboard.event.exposureEventId).toBe(255539);
    expect(dashboard.programs.map((program) => program.program.programName)).toEqual(["My Teams"]);
    expect(dashboard.programs[0]?.teams).toHaveLength(0);
    expect(dashboard.nextGame).toBeNull();
    expect(dashboard.programs[0]?.zeroStateMessage).toContain("no teams selected");
  });
});
