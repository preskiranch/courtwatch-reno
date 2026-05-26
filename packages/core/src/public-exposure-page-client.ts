import * as cheerio from "cheerio";
import { fromZonedTime } from "date-fns-tz";
import { hashSource } from "./change-detection.js";
import { deriveEffectiveGameStatus } from "./game-status.js";
import { extractDivisionMeta, normalizeName } from "./normalization.js";
import type { Division, Game, Team } from "./types.js";
import { DEFAULT_TOURNAMENT_TIMEZONE } from "./types.js";

export interface PublicExposureTeamResult {
  divisions: Division[];
  teams: Team[];
}

export interface PublicExposureScheduleConfig {
  divisions: Array<{ Id: number; Name: string }>;
  brackets: Array<{
    Id: number;
    Name: string;
    DivisionId: number;
    CrossDivisionIds?: number[];
    ShowStandings?: boolean;
  }>;
}

export interface PublicExposureGameOptions {
  divisionIds?: string[];
  eventSlug?: string;
  timezone?: string;
}

export interface PublicExposurePageClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class PublicExposurePageClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: PublicExposurePageClientOptions = {}) {
    this.baseUrl =
      options.baseUrl ??
      process.env.EXPOSURE_PUBLIC_BASE_URL ??
      "https://basketball.exposureevents.com";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs =
      options.timeoutMs ??
      Number(process.env.EXPOSURE_PUBLIC_TIMEOUT_MS ?? 12_000);
  }

  async fetchTeams(
    eventId: number,
    eventSlug = "2026-reno-memorial-day-tournament",
    timezone = DEFAULT_TOURNAMENT_TIMEZONE,
  ): Promise<PublicExposureTeamResult> {
    const searchResult = await this.fetchSearch(eventId, eventSlug).catch(
      () => null,
    );
    if (Array.isArray(searchResult?.Teams)) {
      const divisions = new Map<string, Division>();
      const teams: Team[] = [];

      for (const sourceTeam of searchResult.Teams) {
        const divisionIdValue = String(sourceTeam.DivisionId ?? "");
        const divisionName = cleanText(
          sourceTeam.Division ?? "Unknown Division",
        );
        if (!divisionIdValue || !sourceTeam.Value || !sourceTeam.Name) continue;

        const divisionId = `division-${eventId}-${divisionIdValue}`;
        const meta = extractDivisionMeta(divisionName);
        divisions.set(divisionId, {
          id: divisionId,
          eventId: `event-${eventId}`,
          exposureDivisionId: divisionIdValue,
          name: divisionName,
          gender: meta.gender,
          gradeLevel: meta.gradeLevel,
          level: meta.level,
          rawJson: { source: "public_search", divisionId: divisionIdValue },
        });

        const name = stripDivisionSuffix(
          cleanText(sourceTeam.Name),
          divisionName,
        );
        const teamId = String(sourceTeam.Value);
        teams.push({
          id: `public-team-${eventId}-${teamId}`,
          eventId: `event-${eventId}`,
          divisionId,
          exposureTeamId: teamId,
          name,
          normalizedName: normalizeName(name),
          clubName: null,
          normalizedClubName: null,
          coachName: null,
          sourceUrl: new URL(
            `/${eventId}/${eventSlug}/teams/${sourceTeam.Slug ?? ""}?divisionteamid=${teamId}`,
            this.baseUrl,
          ).toString(),
          divisionName,
          gender: meta.gender,
          gradeLevel: meta.gradeLevel,
          level: meta.level,
          rawJson: { source: "public_search", timezone, ...sourceTeam },
          lastSeenAt: new Date().toISOString(),
        });
      }

      return { divisions: Array.from(divisions.values()), teams };
    }

    const url = `${this.baseUrl}/${eventId}/${eventSlug}/teams`;
    const response = await this.fetchWithTimeout(url, {
      headers: {
        "User-Agent":
          "CourtWatchAAU/0.1 (+independent companion tracker; respectful cache-backed polling)",
      },
    });
    if (!response.ok) {
      throw new Error(
        `Public teams page request failed with ${response.status}`,
      );
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const divisions = new Map<string, Division>();
    const teams: Team[] = [];
    let currentDivisionName = "Unknown Division";

    $("#content h2, #content a[href*='/teams/']").each((_, element) => {
      const node = $(element);
      if (element.tagName.toLowerCase() === "h2") {
        currentDivisionName = node.text().replace(/\s+/g, " ").trim();
        return;
      }

      const href = node.attr("href") ?? "";
      const name = node.text().replace(/\s+/g, " ").trim();
      if (!name || !href.includes("/teams/")) return;

      const divisionTeamId = new URL(href, this.baseUrl).searchParams.get(
        "divisionteamid",
      );
      const divisionKey = normalizeName(currentDivisionName) || "unknown";
      const divisionId = `public-division-${eventId}-${divisionKey.replace(/\s/g, "-")}`;
      const meta = extractDivisionMeta(currentDivisionName);
      divisions.set(divisionId, {
        id: divisionId,
        eventId: `event-${eventId}`,
        exposureDivisionId: divisionKey,
        name: currentDivisionName,
        gender: meta.gender,
        gradeLevel: meta.gradeLevel,
        level: meta.level,
        rawJson: { source: "public_page" },
      });

      teams.push({
        id: `public-team-${eventId}-${divisionTeamId ?? normalizeName(`${currentDivisionName}-${name}`).replace(/\s/g, "-")}`,
        eventId: `event-${eventId}`,
        divisionId,
        exposureTeamId: divisionTeamId,
        name,
        normalizedName: normalizeName(name),
        clubName: null,
        normalizedClubName: null,
        coachName: null,
        sourceUrl: new URL(href, this.baseUrl).toString(),
        divisionName: currentDivisionName,
        gender: meta.gender,
        gradeLevel: meta.gradeLevel,
        level: meta.level,
        rawJson: { source: "public_page", href, timezone },
        lastSeenAt: new Date().toISOString(),
      });
    });

    return { divisions: Array.from(divisions.values()), teams };
  }

  async fetchScheduleConfig(
    eventId: number,
    eventSlug = "2026-reno-memorial-day-tournament",
  ): Promise<PublicExposureScheduleConfig> {
    const html = await this.fetchText(
      `${this.baseUrl}/${eventId}/${eventSlug}/schedule`,
    );
    return {
      divisions: parseJsonArrayAssignment(html, "divisions"),
      brackets: parseJsonArrayAssignment(html, "brackets"),
    };
  }

  async fetchGames(
    eventId: number,
    options: PublicExposureGameOptions = {},
  ): Promise<Game[]> {
    const eventSlug = options.eventSlug ?? "2026-reno-memorial-day-tournament";
    const timezone = options.timezone ?? DEFAULT_TOURNAMENT_TIMEZONE;
    const config = await this.fetchScheduleConfig(eventId, eventSlug);
    const selectedDivisionIds = new Set(
      (options.divisionIds ?? []).map(String).filter(Boolean),
    );
    const divisions = selectedDivisionIds.size
      ? config.divisions.filter((division) =>
          selectedDivisionIds.has(String(division.Id)),
        )
      : config.divisions;
    const bracketsByDivision = groupBracketsByDivision(
      config.brackets,
      eventId,
      eventSlug,
      this.baseUrl,
    );
    const games: Game[] = [];

    for (const division of divisions) {
      const rawGroups = await this.fetchEventGames(
        eventId,
        eventSlug,
        division.Id,
      );
      for (const group of rawGroups) {
        if (!Array.isArray(group.Games)) continue;
        for (const rawGame of group.Games) {
          const mapped = mapPublicExposureGame(
            rawGame,
            eventId,
            bracketsByDivision.get(String(rawGame.DivisionId ?? division.Id)) ??
              [],
            eventSlug,
            this.baseUrl,
            timezone,
          );
          if (mapped) games.push(mapped);
        }
      }
      await sleep(Number(process.env.EXPOSURE_PUBLIC_REQUEST_DELAY_MS ?? 125));
    }

    return games;
  }

  private async fetchSearch(
    eventId: number,
    eventSlug: string,
  ): Promise<PublicExposureSearchResult> {
    const url = `${this.baseUrl}/${eventId}/${eventSlug}/search?eventid=${eventId}&eventname=${eventSlug}`;
    const response = await this.fetchWithTimeout(url, {
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent":
          "CourtWatchAAU/0.1 (+independent companion tracker; respectful cache-backed polling)",
      },
    });
    if (!response.ok)
      throw new Error(`Public search request failed with ${response.status}`);
    return (await response.json()) as PublicExposureSearchResult;
  }

  private async fetchEventGames(
    eventId: number,
    eventSlug: string,
    divisionId: number,
  ) {
    const url = `${this.baseUrl}/${eventId}/${eventSlug}/eventgames?divisionId=${divisionId}`;
    const response = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent":
          "CourtWatchAAU/0.1 (+independent companion tracker; respectful cache-backed polling)",
      },
      body: new URLSearchParams({
        divisionId: String(divisionId),
        sortBy: "0",
      }).toString(),
    });
    if (!response.ok)
      throw new Error(
        `Public eventgames request failed with ${response.status} for division ${divisionId}`,
      );
    return (await response.json()) as PublicExposureGameGroup[];
  }

  private async fetchText(url: string) {
    const response = await this.fetchWithTimeout(url, {
      headers: {
        Accept: "text/html",
        "User-Agent":
          "CourtWatchAAU/0.1 (+independent companion tracker; respectful cache-backed polling)",
      },
    });
    if (!response.ok)
      throw new Error(`Public page request failed with ${response.status}`);
    return response.text();
  }

  private async fetchWithTimeout(
    input: string | URL | Request,
    init: RequestInit = {},
  ): Promise<Response> {
    if (init.signal || this.timeoutMs <= 0) return this.fetchImpl(input, init);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(input, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

interface PublicExposureSearchResult {
  Teams?: PublicExposureSearchTeam[];
  Players?: unknown[];
}

interface PublicExposureSearchTeam {
  Division?: string;
  DivisionId?: number | string;
  Slug?: string;
  Value?: number | string;
  Name?: string;
}

interface PublicExposureGameGroup {
  Name?: string;
  Games?: PublicExposureGameRaw[];
}

interface PublicExposureBracketLink {
  id: string;
  name: string;
  url: string;
}

interface PublicExposureGameRaw {
  Id?: number | string;
  VenueName?: string;
  CourtName?: string;
  VenueAbbr?: string;
  LocationAbbr?: string;
  AwayDivisionTeamId?: number | string | null;
  HomeDivisionTeamId?: number | string | null;
  Number?: number | string | null;
  GameTypeName?: string | null;
  GameType?: number | string | null;
  HomeTeamName?: string | null;
  AwayTeamName?: string | null;
  DivisionName?: string | null;
  DivisionId?: number | string | null;
  Status?: string | null;
  Started?: boolean;
  HomeTeamScoreDisplay?: string | null;
  AwayTeamScoreDisplay?: string | null;
  HomeTeamIsWinner?: boolean;
  AwayTeamIsWinner?: boolean;
  DateFormatted?: string | null;
  TimeFormatted?: string | null;
  StreamingId?: string | null;
  [key: string]: unknown;
}

function mapPublicExposureGame(
  raw: PublicExposureGameRaw,
  eventId: number,
  bracketLinks: PublicExposureBracketLink[],
  eventSlug: string,
  baseUrl: string,
  timezone: string,
): Game | null {
  const id = stringOrNull(raw.Id);
  if (!id) return null;

  const date = stringOrNull(raw.DateFormatted) ?? "5/23/2026";
  const time = normalizeTime(stringOrNull(raw.TimeFormatted) ?? "12:00 PM");
  const startsAt = parseTournamentDateTime(date, time, timezone);
  const homeScore = parseScore(raw.HomeTeamScoreDisplay);
  const awayScore = parseScore(raw.AwayTeamScoreDisplay);
  const status = mapPublicStatus(raw, startsAt, homeScore, awayScore);
  const divisionExposureId = stringOrNull(raw.DivisionId);
  const matchedBracket = matchBracketLink(
    stringOrNull(raw.GameTypeName),
    bracketLinks,
  );
  const rawJson = {
    source: "public_eventgames",
    ...raw,
    BracketUrl: matchedBracket?.url ?? null,
    BracketName: matchedBracket?.name ?? null,
    DivisionBracketUrls: bracketLinks,
  };

  return {
    id: `public-game-${eventId}-${id}`,
    eventId: `event-${eventId}`,
    divisionId: divisionExposureId
      ? `division-${eventId}-${divisionExposureId}`
      : null,
    exposureGameId: id,
    gameNumber: stringOrNull(raw.Number),
    gameType:
      stringOrNull(raw.GameTypeName) ?? stringOrNull(raw.GameType) ?? null,
    scheduledDate: toIsoDate(date),
    scheduledTime: time,
    startsAt: startsAt.toISOString(),
    timezone,
    venueName: stringOrNull(raw.VenueName),
    courtName: stringOrNull(raw.CourtName),
    homeTeamId: publicTeamId(raw.HomeDivisionTeamId, eventId),
    awayTeamId: publicTeamId(raw.AwayDivisionTeamId, eventId),
    homeTeamNameSnapshot: stringOrNull(raw.HomeTeamName),
    awayTeamNameSnapshot: stringOrNull(raw.AwayTeamName),
    homeScore,
    awayScore,
    status,
    officialUrl: new URL(
      `/${eventId}/${eventSlug}/schedule`,
      baseUrl,
    ).toString(),
    streamingUrl: raw.StreamingId
      ? `https://www.ballertv.com/events/${eventSlug}/games/${raw.StreamingId}`
      : null,
    updatedAt: new Date().toISOString(),
    sourceHash: hashSource(rawJson),
    rawJson,
  };
}

function parseJsonArrayAssignment<T>(html: string, key: string): T[] {
  const marker = `${key}:`;
  const start = html.indexOf(marker);
  if (start < 0) return [];
  const arrayStart = html.indexOf("[", start);
  if (arrayStart < 0) return [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = arrayStart; index < html.length; index += 1) {
    const char = html[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') inString = true;
    if (char === "[") depth += 1;
    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(html.slice(arrayStart, index + 1)) as T[];
      }
    }
  }
  return [];
}

function groupBracketsByDivision(
  brackets: PublicExposureScheduleConfig["brackets"],
  eventId: number,
  eventSlug: string,
  baseUrl: string,
): Map<string, PublicExposureBracketLink[]> {
  const grouped = new Map<string, PublicExposureBracketLink[]>();
  for (const bracket of brackets) {
    const divisionId = String(bracket.DivisionId);
    grouped.set(divisionId, [
      ...(grouped.get(divisionId) ?? []),
      {
        id: String(bracket.Id),
        name: bracket.Name,
        url: new URL(
          `/${eventId}/${eventSlug}/bracket/${bracket.Id}`,
          baseUrl,
        ).toString(),
      },
    ]);
  }
  return grouped;
}

function matchBracketLink(
  gameTypeName: string | null,
  bracketLinks: PublicExposureBracketLink[],
): PublicExposureBracketLink | null {
  if (!gameTypeName) return null;
  const normalizedGameType = normalizeName(gameTypeName);
  return (
    bracketLinks.find((bracket) =>
      normalizedGameType.startsWith(normalizeName(bracket.name)),
    ) ?? null
  );
}

function publicTeamId(value: unknown, eventId: number): string | null {
  const id = stringOrNull(value);
  return id ? `public-team-${eventId}-${id}` : null;
}

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripDivisionSuffix(name: string, divisionName: string): string {
  const suffix = `(${divisionName})`;
  return name.endsWith(suffix) ? name.slice(0, -suffix.length).trim() : name;
}

function normalizeTime(time: string): string {
  return time.replace(/\s+(PDT|PST)$/i, "").trim();
}

function parseScore(value: unknown): number | null {
  const text = stringOrNull(value);
  if (!text || !/^\d{1,3}$/.test(text)) return null;
  return Number(text);
}

function mapPublicStatus(
  raw: PublicExposureGameRaw,
  startsAt: Date,
  homeScore: number | null,
  awayScore: number | null,
): Game["status"] {
  const statusText = normalizeName(raw.Status);
  const hasScores = homeScore !== null && awayScore !== null;
  const hasWinner = Boolean(raw.HomeTeamIsWinner || raw.AwayTeamIsWinner);
  if (
    hasScores &&
    (hasWinner ||
      statusText.includes("final") ||
      statusText.includes("complete"))
  )
    return "final";
  if (raw.Started) return "playing_now";
  return deriveEffectiveGameStatus({
    startsAt: startsAt.toISOString(),
    status: "upcoming",
  });
}

function parseTournamentDateTime(
  date: string,
  time: string,
  timezone: string,
): Date {
  const [month = "5", day = "23", year = "2026"] = date.split("/");
  const match = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  let hour = Number(match?.[1] ?? 12);
  const minute = Number(match?.[2] ?? 0);
  const meridiem = (match?.[3] ?? "PM").toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  const local = `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
  return fromZonedTime(local, timezone);
}

function toIsoDate(date: string): string {
  const [month = "5", day = "23", year = "2026"] = date.split("/");
  return `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function sleep(ms: number) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
