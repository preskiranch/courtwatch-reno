import { describe, expect, it } from "vitest";
import { californiaTournamentRegionFromPlace } from "./california-region.js";

describe("California tournament region cutoff", () => {
  it("keeps Bakersfield and cities north of Bakersfield in Northern California", () => {
    expect(californiaTournamentRegionFromPlace("Bakersfield, CA")).toBe(
      "Northern California",
    );
    expect(californiaTournamentRegionFromPlace("Fresno, California")).toBe(
      "Northern California",
    );
    expect(californiaTournamentRegionFromPlace("Oakland, CA")).toBe(
      "Northern California",
    );
    expect(californiaTournamentRegionFromPlace("San Ramon, CA")).toBe(
      "Northern California",
    );
  });

  it("classifies Southern California cities south of Bakersfield correctly", () => {
    expect(californiaTournamentRegionFromPlace("Westminster, California")).toBe(
      "Southern California",
    );
    expect(californiaTournamentRegionFromPlace("Ontario, CA")).toBe(
      "Southern California",
    );
    expect(californiaTournamentRegionFromPlace("Lancaster, CA")).toBe(
      "Southern California",
    );
    expect(californiaTournamentRegionFromPlace("Northridge, CA")).toBe(
      "Southern California",
    );
    expect(californiaTournamentRegionFromPlace("San Diego, CA")).toBe(
      "Southern California",
    );
    expect(californiaTournamentRegionFromPlace("Carson, CA")).toBe(
      "Southern California",
    );
    expect(californiaTournamentRegionFromPlace("Ladera Ranch, CA")).toBe(
      "Southern California",
    );
    expect(californiaTournamentRegionFromPlace("Lake Forest, CA")).toBe(
      "Southern California",
    );
    expect(californiaTournamentRegionFromPlace("San Marcos, CA")).toBe(
      "Southern California",
    );
    expect(californiaTournamentRegionFromPlace("Santa Barbara, CA")).toBe(
      "Southern California",
    );
    expect(californiaTournamentRegionFromPlace("Seal Beach, CA")).toBe(
      "Southern California",
    );
    expect(californiaTournamentRegionFromPlace("Ontartio, CA")).toBe(
      "Southern California",
    );
  });

  it("uses the city before broad regional tags", () => {
    expect(
      californiaTournamentRegionFromPlace(
        "Westminster, CA Northern California",
      ),
    ).toBe("Southern California");
    expect(californiaTournamentRegionFromPlace("Ontario, CA NorCal")).toBe(
      "Southern California",
    );
    expect(
      californiaTournamentRegionFromPlace("San Ramon, CA Southern California"),
    ).toBe("Northern California");
  });
});
