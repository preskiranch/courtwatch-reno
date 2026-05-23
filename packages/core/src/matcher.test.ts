import { describe, expect, it } from "vitest";
import { matchTeamToProgram } from "./matcher.js";
import { normalizeName, normalizeProgramName } from "./normalization.js";
import type { ProgramAlias, ProgramWatchlist, Team } from "./types.js";

const arsenal = program("program-arsenal", "Arsenal");
const splash = program("program-splash", "Splash City");

const aliases: ProgramAlias[] = [
  alias("program-arsenal", "Team Arsenal"),
  alias("program-arsenal", "Arsenal Basketball"),
  alias("program-arsenal", "Arsenal Elite"),
  alias("program-splash", "SplashCity"),
  alias("program-splash", "Splash City Basketball")
];

describe("program matching", () => {
  it("matches Arsenal exact and normalized team variants", () => {
    expect(matchTeamToProgram(team("Arsenal"), arsenal, aliases).matchType).toBe("exact");
    expect(matchTeamToProgram(team("Team Arsenal 8th Black"), arsenal, aliases).matched).toBe(true);
    expect(matchTeamToProgram(team("Arsenal Basketball 7th Grade Girls"), arsenal, aliases).matched).toBe(true);
  });

  it("matches Splash City compact and alias variants", () => {
    expect(matchTeamToProgram(team("SplashCity 6th"), splash, aliases).matched).toBe(true);
    expect(matchTeamToProgram(team("Splash City Basketball"), splash, aliases).matched).toBe(true);
  });

  it("supports fuzzy alias matching", () => {
    const result = matchTeamToProgram(team("Splah City 5th"), splash, aliases);
    expect(result.matched).toBe(true);
    expect(result.matchType).toBe("fuzzy");
  });

  it("avoids unrelated false matches", () => {
    expect(matchTeamToProgram(team("Arsenal Tech High"), arsenal, aliases).matched).toBe(false);
    expect(matchTeamToProgram(team("Splash Pad City"), splash, aliases).matched).toBe(false);
  });
});

function program(id: string, name: string): ProgramWatchlist {
  return {
    id,
    userId: null,
    programName: name,
    normalizedProgramName: normalizeProgramName(name),
    active: true,
    createdAt: new Date().toISOString()
  };
}

function alias(programWatchlistId: string, value: string): ProgramAlias {
  return {
    id: `${programWatchlistId}-${value}`,
    programWatchlistId,
    alias: value,
    normalizedAlias: normalizeProgramName(value),
    createdAt: new Date().toISOString()
  };
}

function team(name: string): Team {
  return {
    id: name,
    eventId: "event",
    divisionId: "division",
    exposureTeamId: name,
    name,
    normalizedName: normalizeName(name),
    clubName: null,
    normalizedClubName: null,
    coachName: null,
    sourceUrl: null,
    rawJson: {},
    lastSeenAt: new Date().toISOString()
  };
}
