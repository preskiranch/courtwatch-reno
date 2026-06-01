import {
  scoringZoneForPoint,
  validateCalibrationProfile,
} from "./courtvision-calibration.js";
import type {
  CalibrationProfile,
  CourtVisionTeam,
  GameRules,
  GameSession,
  GameStats,
  ShotEvent,
  ShotScoringInput,
  TeamClassificationResult,
  TeamShotStats,
} from "./courtvision-types.js";

const LOW_CONFIDENCE_THRESHOLD = 0.72;
const SOLO_TEAM_ID = "solo";

export function defaultCourtVisionTeams(): CourtVisionTeam[] {
  return [
    { id: "team-blue", name: "Blue", colorName: "Blue", colorHex: "#2563eb" },
    { id: "team-red", name: "Red", colorName: "Red", colorHex: "#dc2626" },
  ];
}

export function defaultCourtVisionRules(
  mode: GameRules["mode"] = "two_team",
): GameRules {
  return {
    mode,
    targetScore: 21,
    winByTwo: true,
    twoPointersEnabled: true,
    threePointersEnabled: true,
    buzzerEnabled: true,
  };
}

export function createInitialGameSession(params: {
  id: string;
  rules: GameRules;
  teams?: CourtVisionTeam[];
  calibrationProfileId?: string;
  createdAt?: number;
}): GameSession {
  const teams =
    params.rules.mode === "solo"
      ? [{ id: SOLO_TEAM_ID, name: "Solo", colorName: "Orange", colorHex: "#f97316" }]
      : (params.teams ?? defaultCourtVisionTeams()).slice(
          0,
          params.rules.mode === "one_team" ? 1 : 2,
        );
  const createdAt = params.createdAt ?? Date.now();

  return {
    id: params.id,
    createdAt,
    updatedAt: createdAt,
    mode: params.rules.mode,
    rules: params.rules,
    teams,
    calibrationProfileId: params.calibrationProfileId,
    shots: [],
    stats: emptyGameStats(teams),
    scores: Object.fromEntries(teams.map((team) => [team.id, 0])),
    buzzerTriggered: false,
  };
}

export function buildShotEvent(
  input: ShotScoringInput,
  profile: CalibrationProfile | null,
  rules: GameRules,
): ShotEvent {
  const zone = profile ? scoringZoneForPoint(input.shotLocation, profile) : "unknown";
  const { points, needsConfirmation, confirmationReason } = shotPointsForZone({
    zone,
    result: input.result,
    rules,
    teamId: input.teamId,
    confidence: input.confidence,
  });

  return {
    id: `shot-${input.timestamp ?? Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: input.timestamp ?? Date.now(),
    teamId: input.teamId,
    playerId: input.playerId,
    shotLocation: input.shotLocation,
    zone,
    result: input.result,
    points,
    confidence: clampConfidence(input.confidence),
    source: input.source,
    needsConfirmation,
    confirmationReason,
  };
}

export function shotPointsForZone(params: {
  zone: ShotEvent["zone"];
  result: ShotEvent["result"];
  rules: GameRules;
  teamId?: string;
  confidence: number;
}): Pick<ShotEvent, "points" | "needsConfirmation" | "confirmationReason"> {
  if (params.result === "unknown") {
    return { points: 0, needsConfirmation: true, confirmationReason: "unknown_result" };
  }
  if (params.result === "missed") {
    return { points: 0, needsConfirmation: false };
  }
  if (!params.teamId && params.rules.mode !== "solo") {
    return { points: 0, needsConfirmation: true, confirmationReason: "unknown_team" };
  }
  if (params.zone === "unknown") {
    return { points: 0, needsConfirmation: true, confirmationReason: "unknown_zone" };
  }
  if (params.confidence < LOW_CONFIDENCE_THRESHOLD) {
    return { points: 0, needsConfirmation: true, confirmationReason: "low_confidence" };
  }
  if (params.zone === "three" && params.rules.threePointersEnabled) {
    return { points: 3, needsConfirmation: false };
  }
  if (params.zone === "two" && params.rules.twoPointersEnabled) {
    return { points: 2, needsConfirmation: false };
  }
  return { points: 0, needsConfirmation: true, confirmationReason: "unknown_zone" };
}

export function applyShotEvent(
  session: GameSession,
  event: ShotEvent,
): GameSession {
  const teamId = event.teamId ?? (session.mode === "solo" ? SOLO_TEAM_ID : undefined);
  const normalizedEvent = teamId ? { ...event, teamId } : event;
  const shots = [...session.shots, normalizedEvent];
  const scores = { ...session.scores };
  if (teamId && !normalizedEvent.needsConfirmation && normalizedEvent.result === "made") {
    scores[teamId] = (scores[teamId] ?? 0) + normalizedEvent.points;
  }

  const nextSession: GameSession = {
    ...session,
    shots,
    scores,
    stats: buildGameStats(session.teams, shots),
    updatedAt: normalizedEvent.timestamp,
  };

  return applyWinner(nextSession);
}

export function undoLastShot(session: GameSession): GameSession {
  const shots = session.shots.slice(0, -1);
  const scores = Object.fromEntries(session.teams.map((team) => [team.id, 0]));
  for (const shot of shots) {
    if (!shot.teamId || shot.needsConfirmation || shot.result !== "made") continue;
    scores[shot.teamId] = (scores[shot.teamId] ?? 0) + shot.points;
  }

  return applyWinner({
    ...session,
    shots,
    scores,
    stats: buildGameStats(session.teams, shots),
    winnerTeamId: undefined,
    endedAt: undefined,
    buzzerTriggered: false,
    updatedAt: Date.now(),
  });
}

export function correctShotEvent(
  session: GameSession,
  shotId: string,
  patch: Partial<Pick<ShotEvent, "teamId" | "zone" | "result" | "points" | "needsConfirmation">>,
): GameSession {
  const shots = session.shots.map((shot) =>
    shot.id === shotId
      ? {
          ...shot,
          ...patch,
          needsConfirmation: patch.needsConfirmation ?? false,
          confirmationReason: patch.needsConfirmation ? shot.confirmationReason : undefined,
        }
      : shot,
  );
  const scores = Object.fromEntries(session.teams.map((team) => [team.id, 0]));
  for (const shot of shots) {
    if (!shot.teamId || shot.needsConfirmation || shot.result !== "made") continue;
    scores[shot.teamId] = (scores[shot.teamId] ?? 0) + shot.points;
  }

  return applyWinner({
    ...session,
    shots,
    scores,
    stats: buildGameStats(session.teams, shots),
    updatedAt: Date.now(),
  });
}

export function hasWon(
  scores: Record<string, number>,
  teamId: string,
  rules: GameRules,
): boolean {
  const score = scores[teamId] ?? 0;
  if (score < rules.targetScore) return false;
  if (!rules.winByTwo) return true;
  const opponentBest = Object.entries(scores)
    .filter(([id]) => id !== teamId)
    .reduce((best, [, value]) => Math.max(best, value), 0);
  return score - opponentBest >= 2;
}

export function classifyTeamByColor(params: {
  sampledHex?: string;
  teams: CourtVisionTeam[];
}): TeamClassificationResult {
  if (!params.sampledHex || params.teams.length === 0) {
    return { confidence: 0, needsConfirmation: true };
  }
  const sample = hexToRgb(params.sampledHex);
  if (!sample) return { confidence: 0, needsConfirmation: true };

  const ranked = params.teams
    .map((team) => ({
      teamId: team.id,
      distance: colorDistance(sample, hexToRgb(team.colorHex)),
    }))
    .filter((item): item is { teamId: string; distance: number } =>
      Number.isFinite(item.distance),
    )
    .sort((a, b) => a.distance - b.distance);
  const best = ranked[0];
  if (!best) return { confidence: 0, needsConfirmation: true };

  const confidence = Math.max(0, Math.min(1, 1 - best.distance / 441.68));
  return {
    teamId: best.teamId,
    confidence,
    needsConfirmation: confidence < LOW_CONFIDENCE_THRESHOLD,
  };
}

export function validateGameReady(params: {
  profile: CalibrationProfile | null;
  rules: GameRules;
  teams: CourtVisionTeam[];
}): string[] {
  const errors: string[] = [];
  if (params.rules.targetScore <= 0) errors.push("Target score must be greater than zero.");
  if (params.rules.mode === "two_team" && params.teams.length < 2) {
    errors.push("Two-team mode needs two teams.");
  }
  if (!params.profile) {
    errors.push("Select or create a calibration profile before starting.");
  } else {
    errors.push(...validateCalibrationProfile(params.profile).errors);
  }
  return errors;
}

function applyWinner(session: GameSession): GameSession {
  const winner = session.teams.find((team) => hasWon(session.scores, team.id, session.rules));
  if (!winner) {
    return {
      ...session,
      winnerTeamId: undefined,
      endedAt: undefined,
      buzzerTriggered: false,
    };
  }
  return {
    ...session,
    winnerTeamId: winner.id,
    endedAt: session.endedAt ?? Date.now(),
    buzzerTriggered: session.rules.buzzerEnabled,
  };
}

function emptyGameStats(teams: CourtVisionTeam[]): GameStats {
  return {
    teamStats: Object.fromEntries(teams.map((team) => [team.id, emptyTeamStats()])),
    totalAttempts: 0,
    totalMakes: 0,
    totalMisses: 0,
    shotChart: [],
  };
}

function buildGameStats(teams: CourtVisionTeam[], shots: ShotEvent[]): GameStats {
  const stats = emptyGameStats(teams);
  for (const shot of shots) {
    if (!shot.teamId) continue;
    stats.teamStats[shot.teamId] ??= emptyTeamStats();
    const teamStats = stats.teamStats[shot.teamId];
    if (!teamStats) continue;
    if (shot.result === "unknown") continue;

    teamStats.attempts += 1;
    stats.totalAttempts += 1;
    if (shot.zone === "two") teamStats.twoPointAttempts += 1;
    if (shot.zone === "three") teamStats.threePointAttempts += 1;

    if (shot.result === "made") {
      teamStats.makes += 1;
      teamStats.points += shot.needsConfirmation ? 0 : shot.points;
      teamStats.currentStreak += 1;
      teamStats.bestRun = Math.max(teamStats.bestRun, teamStats.currentStreak);
      stats.totalMakes += 1;
      if (shot.zone === "two") teamStats.twoPointMakes += 1;
      if (shot.zone === "three") teamStats.threePointMakes += 1;
    } else {
      teamStats.misses += 1;
      teamStats.currentStreak = 0;
      stats.totalMisses += 1;
    }
  }
  stats.shotChart = shots;
  return stats;
}

function emptyTeamStats(): TeamShotStats {
  return {
    attempts: 0,
    makes: 0,
    misses: 0,
    twoPointAttempts: 0,
    twoPointMakes: 0,
    threePointAttempts: 0,
    threePointMakes: 0,
    points: 0,
    currentStreak: 0,
    bestRun: 0,
  };
}

function clampConfidence(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0;
  return Math.max(0, Math.min(1, confidence));
}

function hexToRgb(hex: string): [number, number, number] | null {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function colorDistance(
  a: [number, number, number] | null,
  b: [number, number, number] | null,
): number {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.sqrt(
    (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2,
  );
}

