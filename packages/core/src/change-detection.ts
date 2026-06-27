import { createHash } from "node:crypto";
import type { ChangeEventType, Game, GameChangeEvent } from "./types.js";
import { LIVE_GAME_WINDOW_MINUTES } from "./game-status.js";

function stableStringify(value: unknown): string {
  if (value === null || value === undefined || typeof value !== "object") {
    return JSON.stringify(value);
  }
  return JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
}

export function hashSource(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function dedupeKey(parts: Array<string | number | null | undefined>): string {
  return createHash("sha256")
    .update(parts.map((part) => part ?? "").join("|"))
    .digest("hex");
}

function minutesBetween(leftIso: string, rightIso: string): number {
  return Math.abs(new Date(leftIso).getTime() - new Date(rightIso).getTime()) / 60000;
}

function changedEvent(
  game: Game,
  eventType: ChangeEventType,
  previousValue: unknown,
  newValue: unknown,
  affectedTeamId: string | null = null,
  affectedProgramWatchlistId: string | null = null
): GameChangeEvent {
  return {
    id: dedupeKey([game.id, eventType, stableStringify(previousValue), stableStringify(newValue)]).slice(0, 24),
    gameId: game.id,
    affectedTeamId,
    affectedProgramWatchlistId,
    eventType,
    previousValue,
    newValue,
    createdAt: new Date().toISOString(),
    notificationSent: false,
    dedupeKey: dedupeKey([game.id, eventType, stableStringify(previousValue), stableStringify(newValue)])
  };
}

export function detectGameChanges(previous: Game | null, next: Game): GameChangeEvent[] {
  if (!previous) {
    return [
      changedEvent(next, "new_game_added", null, {
        startsAt: next.startsAt,
        courtName: next.courtName,
        venueName: next.venueName,
        homeTeamNameSnapshot: next.homeTeamNameSnapshot,
        awayTeamNameSnapshot: next.awayTeamNameSnapshot
      })
    ];
  }

  const changes: GameChangeEvent[] = [];

  if (previous.scheduledDate !== next.scheduledDate) {
    changes.push(changedEvent(next, "date_changed", previous.scheduledDate, next.scheduledDate));
  }

  if (minutesBetween(previous.startsAt, next.startsAt) >= 2) {
    changes.push(changedEvent(next, "game_time_changed", previous.startsAt, next.startsAt));
  }

  if ((previous.courtName ?? "") !== (next.courtName ?? "")) {
    changes.push(changedEvent(next, "court_changed", previous.courtName, next.courtName));
  }

  if ((previous.venueName ?? "") !== (next.venueName ?? "")) {
    changes.push(changedEvent(next, "venue_changed", previous.venueName, next.venueName));
  }

  const previousOpponentTbd = [previous.homeTeamNameSnapshot, previous.awayTeamNameSnapshot].some((name) => (name ?? "").toLowerCase().includes("tbd"));
  const nextOpponentTbd = [next.homeTeamNameSnapshot, next.awayTeamNameSnapshot].some((name) => (name ?? "").toLowerCase().includes("tbd"));
  if (previousOpponentTbd && !nextOpponentTbd) {
    changes.push(
      changedEvent(
        next,
        "opponent_assigned",
        { home: previous.homeTeamNameSnapshot, away: previous.awayTeamNameSnapshot },
        { home: next.homeTeamNameSnapshot, away: next.awayTeamNameSnapshot }
      )
    );
  }

  if (previous.homeTeamId !== next.homeTeamId || previous.awayTeamId !== next.awayTeamId) {
    changes.push(
      changedEvent(
        next,
        "home_away_changed",
        { homeTeamId: previous.homeTeamId, awayTeamId: previous.awayTeamId },
        { homeTeamId: next.homeTeamId, awayTeamId: next.awayTeamId }
      )
    );
  }

  const previousScore = `${previous.homeScore ?? ""}-${previous.awayScore ?? ""}`;
  const nextScore = `${next.homeScore ?? ""}-${next.awayScore ?? ""}`;
  const scoreWasPosted = previousScore !== nextScore && next.homeScore !== null && next.awayScore !== null;
  if (scoreWasPosted) {
    changes.push(changedEvent(next, "score_posted", previousScore, nextScore));
  }

  if (previous.status !== "final" && next.status === "final") {
    changes.push(changedEvent(next, "final_score", previousScore, nextScore));
  }

  if ((previous.gameType ?? "") !== (next.gameType ?? "") && (next.gameType ?? "").toLowerCase().includes("bracket")) {
    changes.push(changedEvent(next, "bracket_update", previous.gameType, next.gameType));
  }

  return changes;
}

const STARTING_SOON_REMINDER_MINUTES = [15, 30, 60] as const;

export function startingSoonReminderMinuteForGame(
  game: Pick<Game, "startsAt" | "status">,
  now = new Date(),
): number | null {
  if (game.status === "final") return null;

  const startMs = Date.parse(game.startsAt);
  if (!Number.isFinite(startMs)) return null;

  const nowMs = now.getTime();
  const liveUntilMs = startMs + LIVE_GAME_WINDOW_MINUTES * 60_000;
  if (nowMs >= startMs && nowMs <= liveUntilMs) return 0;
  if (nowMs > liveUntilMs || nowMs < startMs - 60 * 60_000) return null;

  const minutesUntil = Math.ceil((startMs - nowMs) / 60_000);
  return (
    STARTING_SOON_REMINDER_MINUTES.find(
      (reminderMinute) => minutesUntil <= reminderMinute,
    ) ?? null
  );
}

export function startingSoonChangeEventsForGame(
  game: Game,
  now = new Date(),
): GameChangeEvent[] {
  const reminderMinutes = startingSoonReminderMinuteForGame(game, now);
  if (reminderMinutes === null) return [];

  const affectedTeamIds = Array.from(
    new Set([game.homeTeamId, game.awayTeamId].filter(Boolean)),
  ) as string[];
  if (affectedTeamIds.length === 0) return [];

  return affectedTeamIds.map((teamId) => {
    const key = dedupeKey([game.id, "starting_soon", teamId, reminderMinutes]);
    return {
      id: key.slice(0, 24),
      gameId: game.id,
      affectedTeamId: teamId,
      affectedProgramWatchlistId: null,
      eventType: "starting_soon",
      previousValue: null,
      newValue: {
        reminderMinutes,
        startsAt: game.startsAt,
        scheduledTime: game.scheduledTime,
        courtName: game.courtName,
        venueName: game.venueName,
        homeTeamNameSnapshot: game.homeTeamNameSnapshot,
        awayTeamNameSnapshot: game.awayTeamNameSnapshot,
      },
      createdAt: now.toISOString(),
      notificationSent: false,
      dedupeKey: key,
    };
  });
}
