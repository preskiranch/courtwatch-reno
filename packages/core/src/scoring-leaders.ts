import type { Game, Team } from "./types.js";

export interface TeamScoringLeader {
  rank: number;
  teamKey: string;
  teamId: string | null;
  teamName: string;
  divisionName: string;
  totalPoints: number;
  gamesScored: number;
}

interface TeamScoringAccumulator {
  teamKey: string;
  teamId: string | null;
  teamName: string;
  divisionName: string;
  totalPoints: number;
  gamesScored: number;
}

export function buildTeamScoringLeaders(games: Game[], teams: Team[]): TeamScoringLeader[] {
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const totals = new Map<string, TeamScoringAccumulator>();

  for (const game of games) {
    addTeamPoints(totals, teamsById, game, "home");
    addTeamPoints(totals, teamsById, game, "away");
  }

  let previousPoints: number | null = null;
  let currentRank = 0;
  return Array.from(totals.values())
    .filter((leader) => leader.gamesScored > 0)
    .sort(compareLeaders)
    .map((leader, index) => {
      if (leader.totalPoints !== previousPoints) {
        currentRank = index + 1;
        previousPoints = leader.totalPoints;
      }
      return { ...leader, rank: currentRank };
    });
}

function addTeamPoints(
  totals: Map<string, TeamScoringAccumulator>,
  teamsById: Map<string, Team>,
  game: Game,
  side: "home" | "away"
) {
  const score = side === "home" ? game.homeScore : game.awayScore;
  if (score === null || !Number.isFinite(score) || score < 0) return;

  const teamId = side === "home" ? game.homeTeamId : game.awayTeamId;
  const team = teamId ? teamsById.get(teamId) : undefined;
  const nameSnapshot = side === "home" ? game.homeTeamNameSnapshot : game.awayTeamNameSnapshot;
  const teamName = team?.name ?? cleanText(nameSnapshot);
  if (!teamName || (!teamId && isPlaceholderTeamName(teamName))) return;

  const teamKey = teamId ? `team:${teamId}` : `snapshot:${game.divisionId ?? "unknown"}:${stableNameKey(teamName)}`;
  const existing = totals.get(teamKey);
  if (existing) {
    existing.totalPoints += score;
    existing.gamesScored += 1;
    return;
  }

  totals.set(teamKey, {
    teamKey,
    teamId: team?.id ?? teamId,
    teamName,
    divisionName: team?.divisionName ?? divisionNameFromGame(game) ?? "Division TBD",
    totalPoints: score,
    gamesScored: 1
  });
}

function compareLeaders(left: TeamScoringAccumulator, right: TeamScoringAccumulator): number {
  return (
    right.totalPoints - left.totalPoints ||
    left.teamName.localeCompare(right.teamName, "en-US", { numeric: true, sensitivity: "base" }) ||
    left.divisionName.localeCompare(right.divisionName, "en-US", { numeric: true, sensitivity: "base" })
  );
}

function cleanText(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function stableNameKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function isPlaceholderTeamName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return normalized === "tbd" || normalized === "bye" || /^[wl]\d+(\s|$)/.test(normalized);
}

function divisionNameFromGame(game: Game): string | null {
  if (!game.rawJson || typeof game.rawJson !== "object" || Array.isArray(game.rawJson)) return null;
  const raw = game.rawJson as Record<string, unknown>;
  for (const key of ["DivisionName", "divisionName", "Division", "division", "AgeGroup", "ageGroup"]) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
