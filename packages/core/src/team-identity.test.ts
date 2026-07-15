import { describe, expect, it } from "vitest";
import {
  teamMatchesWatchIdentity,
  teamWatchIdentity,
  teamWatchSearchBase,
} from "./team-identity.js";

describe("global team watch identity", () => {
  it("adds an age stored only in division metadata", () => {
    expect(
      teamWatchIdentity({
        name: "Splash City",
        divisionName: "10u Division",
        gradeLevel: "10U",
      }),
    ).toEqual({
      displayName: "Splash City 10U",
      normalizedName: "splash city 10u",
      ageLabel: "10U",
    });
  });

  it("keeps different age divisions distinct", () => {
    const ten = teamWatchIdentity({
      name: "Splash City",
      gradeLevel: "10U",
    });
    const thirteen = teamWatchIdentity({
      name: "Splash City",
      divisionName: "13u Division 2",
    });
    expect(ten.normalizedName).toBe("splash city 10u");
    expect(thirteen.normalizedName).toBe("splash city 13u");
  });

  it("converts the highest grade in a combined division to age", () => {
    expect(
      teamWatchIdentity({
        name: "Splash City",
        divisionName: "Boys 2nd/3rd Level 3 Blue",
      }).displayName,
    ).toBe("Splash City 9U");
  });

  it("does not duplicate an age already present in the team name", () => {
    expect(
      teamWatchIdentity({
        name: "PMA Knights 10U",
        gradeLevel: "10U",
      }).displayName,
    ).toBe("PMA Knights 10U");
  });

  it("uses a broad lookup term and an exact canonical match", () => {
    expect(teamWatchSearchBase("Splash City 13U")).toBe("splash city");
    expect(
      teamMatchesWatchIdentity("splash city 13u", {
        name: "Splash City",
        normalizedName: "splash city",
        gradeLevel: "13U",
      }),
    ).toBe(true);
    expect(
      teamMatchesWatchIdentity("splash city 10u", {
        name: "Splash City",
        normalizedName: "splash city",
        gradeLevel: "13U",
      }),
    ).toBe(false);
  });
});
