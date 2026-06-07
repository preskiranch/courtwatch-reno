import { describe, expect, it } from "vitest";
import {
  courtWatchSupportedTournamentRegion,
  isCourtWatchSupportedTournamentRegion,
} from "./tournament-region-scope.js";

describe("Court Watch supported tournament region scope", () => {
  it("keeps Nevada tournaments visible", () => {
    expect(
      courtWatchSupportedTournamentRegion({
        city: "Reno",
        state: "NV",
        location: "Reno, Nevada",
        region: null,
      }),
    ).toBe("Nevada");
  });

  it("splits California by the Bakersfield cutoff", () => {
    expect(
      courtWatchSupportedTournamentRegion({
        city: "Rocklin",
        state: "CA",
        location: "Rocklin, CA",
        region: "Northern California",
      }),
    ).toBe("Northern California");
    expect(
      courtWatchSupportedTournamentRegion({
        city: "Northridge",
        state: "CA",
        location: "Northridge, CA",
        region: "Northern California",
      }),
    ).toBe("Southern California");
  });

  it("does not include other states in the current site scope", () => {
    expect(
      isCourtWatchSupportedTournamentRegion({
        city: "Arlington",
        state: "TX",
        location: "Arlington, TX",
        region: null,
      }),
    ).toBe(false);
  });
});
