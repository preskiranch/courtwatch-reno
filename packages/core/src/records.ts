import { buildTeamScoringLeaders } from "./scoring-leaders.js";
import type { Game, Team, TeamRecordSummary } from "./types.js";

export function buildTeamRecordSummaryMap(
  games: Game[],
  teams: Team[],
): Map<string, TeamRecordSummary> {
  const records = new Map<string, TeamRecordSummary>();
  const officialRecordTeamIds = new Set<string>();

  for (const team of teams) {
    if (!hasRecordActivity(team.record)) continue;
    records.set(team.id, { ...team.record });
    officialRecordTeamIds.add(team.id);
  }

  const leaders = buildTeamScoringLeaders(games, teams, {
    includeUnscoredTeams: true,
  });

  for (const leader of leaders) {
    if (!leader.teamId) continue;
    if (officialRecordTeamIds.has(leader.teamId)) continue;
    if (leader.gamesScored <= 0) continue;
    records.set(leader.teamId, {
      wins: leader.wins,
      losses: leader.losses,
      ties: leader.ties,
      gamesScored: leader.gamesScored,
      totalPoints: leader.totalPoints,
      finalGames: 0,
      gamesSeen: 0,
    });
  }

  for (const game of games) {
    for (const teamId of [game.homeTeamId, game.awayTeamId]) {
      if (!teamId) continue;
      if (officialRecordTeamIds.has(teamId)) continue;
      const record = records.get(teamId);
      if (!record) continue;
      record.gamesSeen += 1;
      if (game.status === "final") record.finalGames += 1;
    }
  }

  return records;
}

export function attachTeamRecordsToGame(
  game: Game,
  records: Map<string, TeamRecordSummary>,
): Game {
  return {
    ...game,
    homeTeamRecord: game.homeTeamId
      ? (records.get(game.homeTeamId) ?? game.homeTeamRecord)
      : game.homeTeamRecord,
    awayTeamRecord: game.awayTeamId
      ? (records.get(game.awayTeamId) ?? game.awayTeamRecord)
      : game.awayTeamRecord,
  };
}

export function attachTeamRecordsToGames(games: Game[], teams: Team[]): Game[] {
  const records = buildTeamRecordSummaryMap(games, teams);
  return games.map((game) => attachTeamRecordsToGame(game, records));
}

function hasRecordActivity(
  record: TeamRecordSummary | null | undefined,
): record is TeamRecordSummary {
  return Boolean(
    record &&
      (record.gamesSeen > 0 ||
        record.gamesScored > 0 ||
        record.finalGames > 0 ||
        record.wins > 0 ||
        record.losses > 0 ||
        record.ties > 0),
  );
}
