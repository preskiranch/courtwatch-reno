import { sanitizeBasketballScore } from "./score-utils.js";
import type { Game, GameStatus, Team } from "./types.js";

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
  latestScore: number | null;
  latestOpponentScore: number | null;
  latestOpponentName: string | null;
  latestScoredAt: string | null;
  latestGameStatus: GameStatus | null;
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
  latestScore: number | null;
  latestOpponentScore: number | null;
  latestOpponentName: string | null;
  latestScoredAt: string | null;
  latestGameStatus: GameStatus | null;
}

export function buildTeamScoringLeaders(
  games: Game[],
  teams: Team[],
  options: TeamScoringLeaderOptions = {},
): TeamScoringLeader[] {
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const totals = new Map<string, TeamScoringAccumulator>();

  for (const game of games) {
    addTeamPoints(totals, teamsById, game, "home");
    addTeamPoints(totals, teamsById, game, "away");
  }

  for (const team of teams) {
    mergeTeamRecord(totals, team);
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
        ties: 0,
        latestScore: null,
        latestOpponentScore: null,
        latestOpponentName: null,
        latestScoredAt: null,
        latestGameStatus: null,
      });
    }
  }

  return rankScoringRows(
    Array.from(totals.values()).filter(
      (leader) => options.includeUnscoredTeams || leader.gamesScored > 0,
    ),
  );
}

export function filterTeamScoringLeadersByDivisionIds(
  leaders: TeamScoringLeader[],
  divisionIds: Iterable<string>,
): TeamScoringLeader[] {
  const selected = new Set(Array.from(divisionIds).filter(Boolean));
  if (selected.size === 0) return [];
  return rankScoringRows(
    leaders.filter(
      (leader) => leader.divisionId !== null && selected.has(leader.divisionId),
    ),
  );
}

function mergeTeamRecord(
  totals: Map<string, TeamScoringAccumulator>,
  team: Team,
) {
  const record = team.record;
  if (!record || !hasRecordActivity(record)) return;
  const teamKey = `team:${team.id}`;
  const existing = totals.get(teamKey);
  if (existing && existing.gamesScored > 0) return;
  totals.set(teamKey, {
    teamKey,
    teamId: team.id,
    teamName: team.name,
    divisionId: team.divisionId,
    divisionName: team.divisionName ?? "Division TBD",
    totalPoints: record.totalPoints,
    gamesScored: record.gamesScored,
    wins: record.wins,
    losses: record.losses,
    ties: record.ties,
    latestScore: existing?.latestScore ?? null,
    latestOpponentScore: existing?.latestOpponentScore ?? null,
    latestOpponentName: existing?.latestOpponentName ?? null,
    latestScoredAt: existing?.latestScoredAt ?? null,
    latestGameStatus: existing?.latestGameStatus ?? null,
  });
}

function hasRecordActivity(record: NonNullable<Team["record"]>): boolean {
  return (
    record.gamesScored > 0 ||
    record.totalPoints > 0 ||
    record.wins > 0 ||
    record.losses > 0 ||
    record.ties > 0 ||
    record.finalGames > 0 ||
    record.gamesSeen > 0
  );
}

function addTeamPoints(
  totals: Map<string, TeamScoringAccumulator>,
  teamsById: Map<string, Team>,
  game: Game,
  side: "home" | "away",
) {
  const score = sanitizeBasketballScore(
    side === "home" ? game.homeScore : game.awayScore,
  );
  if (score === null) return;

  const teamId = side === "home" ? game.homeTeamId : game.awayTeamId;
  const team = teamId ? teamsById.get(teamId) : undefined;
  const nameSnapshot =
    side === "home" ? game.homeTeamNameSnapshot : game.awayTeamNameSnapshot;
  const teamName = team?.name ?? cleanText(nameSnapshot);
  if (!teamName || (!teamId && isPlaceholderTeamName(teamName))) return;

  const opponentTeamId = side === "home" ? game.awayTeamId : game.homeTeamId;
  const opponentTeam = opponentTeamId
    ? teamsById.get(opponentTeamId)
    : undefined;
  const opponentNameSnapshot =
    side === "home" ? game.awayTeamNameSnapshot : game.homeTeamNameSnapshot;
  const opponentName = opponentTeam?.name ?? cleanText(opponentNameSnapshot);
  const opponentScore = sanitizeBasketballScore(
    side === "home" ? game.awayScore : game.homeScore,
  );
  const record = recordFromFinalScore(
    game,
    score,
    opponentScore,
    opponentTeamId,
    opponentName,
  );
  const teamKey = teamId
    ? `team:${teamId}`
    : `snapshot:${game.divisionId ?? "unknown"}:${stableNameKey(teamName)}`;
  const existing = totals.get(teamKey);
  if (existing) {
    existing.totalPoints += score;
    existing.gamesScored += 1;
    existing.wins += record.wins;
    existing.losses += record.losses;
    existing.ties += record.ties;
    updateLatestScore(existing, game, score, opponentScore, opponentName);
    return;
  }

  const next: TeamScoringAccumulator = {
    teamKey,
    teamId: team?.id ?? teamId,
    teamName,
    divisionId: team?.divisionId ?? game.divisionId,
    divisionName:
      team?.divisionName ?? divisionNameFromGame(game) ?? "Division TBD",
    totalPoints: score,
    gamesScored: 1,
    wins: record.wins,
    losses: record.losses,
    ties: record.ties,
    latestScore: null,
    latestOpponentScore: null,
    latestOpponentName: null,
    latestScoredAt: null,
    latestGameStatus: null,
  };
  updateLatestScore(next, game, score, opponentScore, opponentName);
  totals.set(teamKey, next);
}

function recordFromFinalScore(
  game: Game,
  score: number,
  opponentScore: number | null,
  opponentTeamId: string | null,
  opponentName: string,
): Pick<TeamScoringAccumulator, "wins" | "losses" | "ties"> {
  if (game.status !== "final") return zeroRecord();
  if (
    opponentScore === null ||
    !Number.isFinite(opponentScore) ||
    opponentScore < 0
  )
    return zeroRecord();
  if (!opponentTeamId && (!opponentName || isPlaceholderTeamName(opponentName)))
    return zeroRecord();
  if (score > opponentScore) return { wins: 1, losses: 0, ties: 0 };
  if (score < opponentScore) return { wins: 0, losses: 1, ties: 0 };
  return { wins: 0, losses: 0, ties: 1 };
}

function zeroRecord(): Pick<
  TeamScoringAccumulator,
  "wins" | "losses" | "ties"
> {
  return { wins: 0, losses: 0, ties: 0 };
}

function updateLatestScore(
  leader: TeamScoringAccumulator,
  game: Game,
  score: number,
  opponentScore: number | null,
  opponentName: string,
) {
  if (
    opponentScore === null ||
    !Number.isFinite(opponentScore) ||
    opponentScore < 0
  )
    return;
  const scoredAt = bestGameTimestamp(game);
  if (
    leader.latestScoredAt &&
    Date.parse(leader.latestScoredAt) > Date.parse(scoredAt)
  ) {
    return;
  }
  leader.latestScore = score;
  leader.latestOpponentScore = opponentScore;
  leader.latestOpponentName =
    opponentName && !isPlaceholderTeamName(opponentName) ? opponentName : null;
  leader.latestScoredAt = scoredAt;
  leader.latestGameStatus = game.status;
}

function bestGameTimestamp(game: Game): string {
  const updated = Date.parse(game.updatedAt);
  const startsAt = Date.parse(game.startsAt);
  if (Number.isFinite(updated) && Number.isFinite(startsAt)) {
    return new Date(Math.max(updated, startsAt)).toISOString();
  }
  if (Number.isFinite(updated)) return new Date(updated).toISOString();
  if (Number.isFinite(startsAt)) return new Date(startsAt).toISOString();
  return new Date(0).toISOString();
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

function compareLeaders(
  left: TeamScoringAccumulator,
  right: TeamScoringAccumulator,
): number {
  return (
    right.totalPoints - left.totalPoints ||
    left.teamName.localeCompare(right.teamName, "en-US", {
      numeric: true,
      sensitivity: "base",
    }) ||
    left.divisionName.localeCompare(right.divisionName, "en-US", {
      numeric: true,
      sensitivity: "base",
    })
  );
}

function cleanText(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function stableNameKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isPlaceholderTeamName(name: string): boolean {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return (
    normalized === "tbd" ||
    normalized === "bye" ||
    /^[wl]\d+(\s|$)/.test(normalized)
  );
}

function divisionNameFromGame(game: Game): string | null {
  if (
    !game.rawJson ||
    typeof game.rawJson !== "object" ||
    Array.isArray(game.rawJson)
  )
    return null;
  const raw = game.rawJson as Record<string, unknown>;
  for (const key of [
    "DivisionName",
    "divisionName",
    "Division",
    "division",
    "AgeGroup",
    "ageGroup",
  ]) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
