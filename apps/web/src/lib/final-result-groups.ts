import type {
  DivisionResult,
  DivisionResultGroup,
  Team,
} from "@courtwatch/core";

export type FollowedFinalResultGroup = DivisionResultGroup & {
  followedTeamsWithoutPlacement: Team[];
  hasPostedPlacements: boolean;
};

export function finalResultGroupsForFollowedTeams(
  groups: DivisionResultGroup[],
  followedTeams: Team[],
): FollowedFinalResultGroup[] {
  if (followedTeams.length === 0) return [];

  const groupsByDivisionId = new Map(
    groups.map((group) => [group.divisionId, group]),
  );
  const usedDivisionIds = new Set<string>();
  const followedTeamsByDivisionId = groupFollowedTeamsByDivision(followedTeams);
  const followedGroups = groups.flatMap((group) => {
    const teamsInDivision = matchingFollowedTeamsForResultGroup(
      group,
      followedTeams,
      followedTeamsByDivisionId,
    );
    if (teamsInDivision.length === 0) return [];

    usedDivisionIds.add(group.divisionId);
    for (const team of teamsInDivision) {
      if (team.divisionId) usedDivisionIds.add(team.divisionId);
    }
    const followedTeamsWithoutPlacement = teamsInDivision.filter(
      (team) =>
        !group.rows.some((result) => resultMatchesFollowedTeam(result, team)),
    );
    return [
      {
        ...group,
        rows: group.rows,
        followedTeamsWithoutPlacement,
        hasPostedPlacements: group.rows.length > 0,
      },
    ];
  });

  const missingGroups = Array.from(followedTeamsByDivisionId.entries())
    .filter(([divisionId]) => !usedDivisionIds.has(divisionId))
    .map(([divisionId, teams]) =>
      syntheticGroupForFollowedTeams(
        groupsByDivisionId.get(divisionId),
        divisionId,
        teams,
      ),
    );

  return [...followedGroups, ...missingGroups];
}

function matchingFollowedTeamsForResultGroup(
  group: DivisionResultGroup,
  followedTeams: Team[],
  followedTeamsByDivisionId: Map<string, Team[]>,
): Team[] {
  const matches = new Map<string, Team>();
  for (const team of followedTeamsByDivisionId.get(group.divisionId) ?? []) {
    matches.set(team.id, team);
  }
  for (const team of followedTeams) {
    if (group.rows.some((result) => resultMatchesFollowedTeam(result, team))) {
      matches.set(team.id, team);
    }
  }
  return Array.from(matches.values());
}

function groupFollowedTeamsByDivision(
  followedTeams: Team[],
): Map<string, Team[]> {
  const teamsByDivisionId = new Map<string, Team[]>();
  for (const team of followedTeams) {
    if (!team.divisionId) continue;
    const teams = teamsByDivisionId.get(team.divisionId) ?? [];
    teams.push(team);
    teamsByDivisionId.set(team.divisionId, teams);
  }
  return teamsByDivisionId;
}

function syntheticGroupForFollowedTeams(
  existingGroup: DivisionResultGroup | undefined,
  divisionId: string,
  teams: Team[],
): FollowedFinalResultGroup {
  const firstTeam = teams[0];
  return {
    divisionId,
    divisionName:
      existingGroup?.divisionName ?? firstTeam?.divisionName ?? "Division TBD",
    gender: existingGroup?.gender ?? firstTeam?.gender ?? null,
    gradeLevel: existingGroup?.gradeLevel ?? firstTeam?.gradeLevel ?? null,
    level: existingGroup?.level ?? firstTeam?.level ?? null,
    sourceUrl: existingGroup?.sourceUrl ?? firstTeam?.sourceUrl ?? null,
    lastUpdatedAt: existingGroup?.lastUpdatedAt ?? null,
    isOfficial: existingGroup?.isOfficial ?? false,
    rows: [],
    followedTeamsWithoutPlacement: teams,
    hasPostedPlacements: existingGroup ? existingGroup.rows.length > 0 : false,
  };
}

function resultMatchesFollowedTeam(
  result: Pick<
    DivisionResult,
    "divisionId" | "teamId" | "teamNameSnapshot" | "teamSourceUrl"
  >,
  team: Team,
): boolean {
  if (result.teamId && result.teamId === team.id) return true;
  const sourceUrl = normalizeUrl(result.teamSourceUrl);
  if (sourceUrl && sourceUrl === normalizeUrl(team.sourceUrl)) return true;
  return (
    result.divisionId === team.divisionId &&
    normalizeTeamMatchName(result.teamNameSnapshot) ===
      normalizeTeamMatchName(teamDisplayName(team))
  );
}

function normalizeTeamMatchName(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\b(splash city)\s*(\d+u)\b/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value.trim();
  }
}

type TeamNameDisplayInput = Pick<Team, "name" | "divisionName" | "gradeLevel">;

function teamDisplayName(team: TeamNameDisplayInput): string {
  const ageLabel = splashCityAgeLabel(
    team.name,
    team.divisionName,
    team.gradeLevel,
  );
  return ageLabel ? `Splash City ${ageLabel}` : team.name;
}

function splashCityAgeLabel(
  name: string,
  ...contexts: Array<string | null | undefined>
): string | null {
  if (!isSplashCityName(name)) return null;

  const sources = [name, ...contexts].filter((value): value is string =>
    Boolean(value),
  );
  return (
    sources.map(extractAgeLabel).find(Boolean) ??
    sources.map(extractGradeAgeLabel).find(Boolean) ??
    null
  );
}

function isSplashCityName(name: string): boolean {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const compact = normalized.replace(/\s+/g, "");
  return (
    compact.startsWith("splashcity") || normalized.startsWith("splash city ")
  );
}

function extractAgeLabel(value: string): string | null {
  const match = value.match(/\b(\d{1,2})\s*u\b/i);
  return match ? `${Number(match[1])}U` : null;
}

function extractGradeAgeLabel(value: string): string | null {
  const grades = Array.from(
    value.toLowerCase().matchAll(/\b(\d{1,2})(?:st|nd|rd|th)\s*(?:grade)?\b/g),
  ).map((match) => Number(match[1]));
  const highestGrade = Math.max(...grades.filter(Number.isFinite));
  if (!Number.isFinite(highestGrade)) return null;
  const age = highestGrade + 6;
  return age >= 6 && age <= 19 ? `${age}U` : null;
}
