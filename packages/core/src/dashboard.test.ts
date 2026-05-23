import { describe, expect, it } from "vitest";
import { buildDashboard } from "./dashboard.js";
import { seedSnapshot } from "./seed-data.js";

describe("dashboard response", () => {
  it("returns watched program summaries and a next game", () => {
    const dashboard = buildDashboard(seedSnapshot, new Date("2026-05-23T20:00:00.000Z"));
    expect(dashboard.event.exposureEventId).toBe(255539);
    expect(dashboard.programs.map((program) => program.program.programName)).toEqual(["Arsenal", "Splash City"]);
    expect(dashboard.programs.find((program) => program.program.programName === "Splash City")?.teams.length).toBeGreaterThan(0);
    expect(dashboard.nextGame?.id).toBe("game-splash-4-next");
  });
});
