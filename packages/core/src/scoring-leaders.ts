import type { Game, Team } from "./types.js";

export interface TeamScoringLeader {
  rank: number;
  teamKey: string;
  teamId: string | null;
  teamName: string;
  divisionId: string | null;
  divisionName: string;
  totalPoints: number;
  gamesScored: number;
  wins: number;
  losses: number;
  ties: number;
}

export interface TeamScoringLeaderOptions {
  includeUnscoredTeams?: boolean;
}

interface TeamScoringAccumulator {
  teamKey: string;
  teamId: string | null;
  teamName: string;
  divisionId: string | null;
  divisionName: string;
  totalPoints: number;
  gamesScored: number;
  wins: number;
  losses: number;
  ties: number;
}

export function buildTeamScoringLeaders(games: Game[], teams: Team[], options: TeamScoringLeaderOptions = {}): TeamScoringLeader[] {
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const totals = new Map<string, TeamScoringAccumulator>();

  for (const game of games) {
    addTeamPoints(totals, teamsById, game, "home");
    addTeamPoints(totals, teamsById, game, "away");
  }

  if (options.includeUnscoredTeams) {
    for (const team of teams) {
      const teamKey = `team:${team.id}`;
      if (totals.has(teamKey)) continue;
      totals.set(teamKey, {
        teamKey,
        teamId: team.id,
        teamName: team.name,
        divisionId: team.divisionId,
        divisionName: team.divisionName ?? "Division TBD",
        totalPoints: 0,
        gamesScored: 0,
        wins: 0,
        losses: 0,
        ties: 0
      });
    }
  }

  return rankScoringRows(Array.from(totals.values()).filter((leader) => options.includeUnscoredTeams || leader.gamesScored > 0));
}

export function filterTeamScoringLeadersByDivisionIds(leaders: TeamScoringLeader[], divisionIds: Iterable<string>): TeamScoringLeader[] {
  const selected = new Set(Array.from(divisionIds).filter(Boolean));
  if (selected.size === 0) return [];
  return rankScoringRows(leaders.filter((leader) => leader.divisionId !== null && selected.has(leader.divisionId)));
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

  const opponentTeamId = side === "home" ? game.awayTeamId : game.homeTeamId;
  const opponentTeam = opponentTeamId ? teamsById.get(opponentTeamId) : undefined;
  const opponentNameSnapshot = side === "home" ? game.awayTeamNameSnapshot : game.homeTeamNameSnapshot;
  const opponentName = opponentTeam?.name ?? cleanText(opponentNameSnapshot);
  const opponentScore = side === "home" ? game.awayScore : game.homeScore;
  const record = recordFromFinalScore(game, score, opponentScore, opponentTeamId, opponentName);
  const teamKey = teamId ? `team:${teamId}` : `snapshot:${game.divisionId ?? "unknown"}:${stableNameKey(teamName)}`;
  const existing = totals.get(teamKey);
  if (existing) {
    existing.totalPoints += score;
    existing.gamesScored += 1;
    existing.wins += record.wins;
    existing.losses += record.losses;
    existing.ties += record.ties;
    return;
  }

  totals.set(teamKey, {
    teamKey,
    teamId: team?.id ?? teamId,
    teamName,
    divisionId: team?.divisionId ?? game.divisionId,
    divisionName: team?.divisionName ?? divisionNameFromGame(game) ?? "Division TBD",
    totalPoints: score,
    gamesScored: 1,
    wins: record.wins,
    losses: record.losses,
    ties: record.ties
  });
}

function recordFromFinalScore(
  game: Game,
  score: number,
  opponentScore: number | null,
  opponentTeamId: string | null,
  opponentName: string
): Pick<TeamScoringAccumulator, "wins" | "losses" | "ties"> {
  if (game.status !== "final") return zeroRecord();
  if (opponentScore === null || !Number.isFinite(opponentScore) || opponentScore < 0) return zeroRecord();
  if (!opponentTeamId && (!opponentName || isPlaceholderTeamName(opponentName))) return zeroRecord();
  if (score > opponentScore) return { wins: 1, losses: 0, ties: 0 };
  if (score < opponentScore) return { wins: 0, losses: 1, ties: 0 };
  return { wins: 0, losses: 0, ties: 1 };
}

function zeroRecord(): Pick<TeamScoringAccumulator, "wins" | "losses" | "ties"> {
  return { wins: 0, losses: 0, ties: 0 };
}

function rankScoringRows(rows: TeamScoringAccumulator[]): TeamScoringLeader[] {
  let previousPoints: number | null = null;
  let currentRank = 0;
  return [...rows].sort(compareLeaders).map((leader, index) => {
    if (leader.totalPoints !== previousPoints) {
      currentRank = index + 1;
      previousPoints = leader.totalPoints;
    }
    return { ...leader, rank: currentRank };
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
