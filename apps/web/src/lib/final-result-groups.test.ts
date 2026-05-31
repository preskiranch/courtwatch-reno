import { describe, expect, it } from "vitest";
import type {
  DivisionResult,
  DivisionResultGroup,
  Team,
} from "@courtwatch/core";
import { finalResultGroupsForFollowedTeams } from "./final-result-groups";

function team(input: Partial<Team> & Pick<Team, "id" | "name">): Team {
  return {
    eventId: "event-reno",
    divisionId: "division-blue",
    exposureTeamId: input.id,
    normalizedName: input.name.toLowerCase(),
    clubName: null,
    normalizedClubName: null,
    coachName: null,
    sourceUrl: `https://example.com/team/${input.id}`,
    divisionName: "Boys 2nd/3rd Level 3 Blue",
    gender: "Boys",
    gradeLevel: "2ND",
    level: "Level 3",
    rawJson: {},
    lastSeenAt: "2026-05-25T12:00:00.000Z",
    isFollowed: true,
    ...input,
  };
}

function result(input: {
  teamId: string;
  teamNameSnapshot: string;
  placement: 1 | 2 | 3;
  divisionId?: string;
}): DivisionResult {
  return {
    id: `result-${input.divisionId ?? "division-blue"}-${input.placement}`,
    eventId: "event-reno",
    divisionId: input.divisionId ?? "division-blue",
    divisionName:
      input.divisionId === "division-green"
        ? "Boys 4th Level 2 Green"
        : "Boys 2nd/3rd Level 3 Blue",
    gender: "Boys",
    gradeLevel: "2ND",
    level: "Level 3",
    teamId: input.teamId,
    teamNameSnapshot: input.teamNameSnapshot,
    teamSourceUrl: `https://example.com/team/${input.teamId}`,
    placement: input.placement,
    medalLabel:
      input.placement === 1
        ? "Gold"
        : input.placement === 2
          ? "Silver"
          : "Bronze",
    bracketLabel: null,
    source: "bracket_final",
    sourceUrl: "https://example.com/bracket",
    isOfficial: true,
    sourceHash: "hash",
    rawJson: {},
    lastSeenAt: "2026-05-25T12:00:00.000Z",
  };
}

function group(input: {
  divisionId?: string;
  divisionName?: string;
  rows: DivisionResult[];
}): DivisionResultGroup {
  return {
    divisionId: input.divisionId ?? "division-blue",
    divisionName: input.divisionName ?? "Boys 2nd/3rd Level 3 Blue",
    gender: "Boys",
    gradeLevel: "2ND",
    level: "Level 3",
    sourceUrl: "https://example.com/bracket",
    lastUpdatedAt: "2026-05-25T12:00:00.000Z",
    isOfficial: true,
    rows: input.rows,
  };
}

describe("finalResultGroupsForFollowedTeams", () => {
  it("shows the full podium when a followed team placed", () => {
    const podium = group({
      rows: [
        result({
          teamId: "team-splash-9u",
          teamNameSnapshot: "Splash City",
          placement: 1,
        }),
        result({
          teamId: "team-locked-in",
          teamNameSnapshot: "Team Locked In 9u",
          placement: 2,
        }),
        result({
          teamId: "team-iskill",
          teamNameSnapshot: "iSkill 9U",
          placement: 3,
        }),
      ],
    });

    const groups = finalResultGroupsForFollowedTeams(
      [podium],
      [team({ id: "team-splash-9u", name: "Splash City 9U" })],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.rows.map((row) => row.teamNameSnapshot)).toEqual([
      "Splash City",
      "Team Locked In 9u",
      "iSkill 9U",
    ]);
    expect(groups[0]?.followedTeamsWithoutPlacement).toEqual([]);
  });

  it("shows the full podium and keeps a followed team visible when it did not place", () => {
    const podium = group({
      divisionId: "division-blue",
      rows: [
        result({
          teamId: "team-pma",
          teamNameSnapshot: "PMA KNIGHTS",
          placement: 1,
        }),
        result({
          teamId: "team-locked-in",
          teamNameSnapshot: "Team Locked In 12u",
          placement: 2,
        }),
        result({ teamId: "team-hdmd", teamNameSnapshot: "HDMD", placement: 3 }),
      ],
    });

    const groups = finalResultGroupsForFollowedTeams(
      [podium],
      [
        team({
          id: "team-splash-12u",
          name: "Splash City 12U",
          divisionId: "division-blue",
          divisionName: "Boys 6th Level 3 Blue",
        }),
      ],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.rows.map((row) => row.teamNameSnapshot)).toEqual([
      "PMA KNIGHTS",
      "Team Locked In 12u",
      "HDMD",
    ]);
    expect(groups[0]?.hasPostedPlacements).toBe(true);
    expect(
      groups[0]?.followedTeamsWithoutPlacement.map((item) => item.id),
    ).toEqual(["team-splash-12u"]);
  });

  it("scopes groups to the followed teams passed by the current device", () => {
    const blue = group({
      divisionId: "division-blue",
      rows: [
        result({
          teamId: "team-blue",
          teamNameSnapshot: "Blue Team",
          placement: 1,
        }),
      ],
    });
    const green = group({
      divisionId: "division-green",
      divisionName: "Boys 4th Level 2 Green",
      rows: [
        result({
          divisionId: "division-green",
          teamId: "team-green",
          teamNameSnapshot: "Green Team",
          placement: 1,
        }),
      ],
    });

    const alphaGroups = finalResultGroupsForFollowedTeams(
      [blue, green],
      [
        team({
          id: "team-blue",
          name: "Blue Team",
          divisionId: "division-blue",
        }),
      ],
    );
    const betaGroups = finalResultGroupsForFollowedTeams(
      [blue, green],
      [
        team({
          id: "team-green",
          name: "Green Team",
          divisionId: "division-green",
        }),
      ],
    );

    expect(alphaGroups.map((item) => item.divisionId)).toEqual([
      "division-blue",
    ]);
    expect(betaGroups.map((item) => item.divisionId)).toEqual([
      "division-green",
    ]);
  });

  it("matches followed teams inside synthetic standings pool result groups", () => {
    const poolA = group({
      divisionId: "division-blue-pool-a",
      divisionName: "Boys 15U - Pool A",
      rows: [
        result({
          divisionId: "division-blue-pool-a",
          teamId: "team-pma",
          teamNameSnapshot: "PMA Knights Red 15U",
          placement: 1,
        }),
        result({
          divisionId: "division-blue-pool-a",
          teamId: "team-atr",
          teamNameSnapshot: "A.T.R. Elite 15U",
          placement: 2,
        }),
        result({
          divisionId: "division-blue-pool-a",
          teamId: "team-javstep",
          teamNameSnapshot: "JavStep 15U",
          placement: 3,
        }),
      ],
    });

    const groups = finalResultGroupsForFollowedTeams(
      [poolA],
      [
        team({
          id: "team-pma",
          name: "PMA Knights Red 15U",
          divisionId: "division-blue",
          divisionName: "Boys 15U",
        }),
      ],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.divisionId).toBe("division-blue-pool-a");
    expect(groups[0]?.followedTeamsWithoutPlacement).toEqual([]);
    expect(groups[0]?.rows.map((row) => row.teamNameSnapshot)).toEqual([
      "PMA Knights Red 15U",
      "A.T.R. Elite 15U",
      "JavStep 15U",
    ]);
  });
});
