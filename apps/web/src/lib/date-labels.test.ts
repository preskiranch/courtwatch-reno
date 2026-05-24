import { describe, expect, it } from "vitest";
import { dateKeyInReno, scheduleDateSectionLabel } from "./date-labels";

describe("schedule date labels", () => {
  it("uses the Reno calendar day after midnight Pacific time", () => {
    expect(dateKeyInReno(new Date("2026-05-24T06:59:00.000Z"))).toBe("2026-05-23");
    expect(dateKeyInReno(new Date("2026-05-24T07:01:00.000Z"))).toBe("2026-05-24");
  });

  it("labels Sunday as today once the Reno date is Sunday", () => {
    expect(scheduleDateSectionLabel("2026-05-24", "2026-05-24")).toBe("Today");
    expect(scheduleDateSectionLabel("2026-05-25", "2026-05-24")).toBe("Tomorrow");
    expect(scheduleDateSectionLabel("2026-05-23", "2026-05-24")).toBe("Saturday, May 23");
  });
});
