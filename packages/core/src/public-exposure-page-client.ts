import * as cheerio from "cheerio";
import { fromZonedTime } from "date-fns-tz";
import type { AnyNode } from "domhandler";
import { hashSource } from "./change-detection.js";
import { deriveEffectiveGameStatus } from "./game-status.js";
import { extractDivisionMeta, normalizeName } from "./normalization.js";
import { sanitizeBasketballScore } from "./score-utils.js";
import type {
  Division,
  DivisionResult,
  Game,
  ResultMedalLabel,
  ResultPlacement,
  Team,
} from "./types.js";
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

const placementMedals: Record<ResultPlacement, ResultMedalLabel> = {
  1: "Gold",
  2: "Silver",
  3: "Bronze",
};

export interface PublicExposureGameOptions {
  divisionIds?: string[];
  eventSlug?: string;
  teamIds?: string[];
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
    const gamesByDivision = await mapWithConcurrency(
      divisions,
      positiveInteger(process.env.EXPOSURE_PUBLIC_GAMES_CONCURRENCY, 4),
      async (division) => {
        const games: Game[] = [];
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
              bracketsByDivision.get(
                String(rawGame.DivisionId ?? division.Id),
              ) ?? [],
              eventSlug,
              this.baseUrl,
              timezone,
            );
            if (mapped) games.push(mapped);
          }
        }
        await sleep(
          Number(process.env.EXPOSURE_PUBLIC_REQUEST_DELAY_MS ?? 125),
        );
        return games;
      },
    );

    const games = gamesByDivision.flat();
    const fallbackTeamIds = Array.from(
      new Set((options.teamIds ?? []).map(String).filter(Boolean)),
    );
    if (games.length > 0 || fallbackTeamIds.length === 0) return games;

    return this.fetchTeamGames(
      eventId,
      eventSlug,
      fallbackTeamIds,
      bracketsByDivision,
      timezone,
    );
  }

  async fetchDivisionResults(
    eventId: number,
    options: Pick<PublicExposureGameOptions, "eventSlug"> = {},
  ): Promise<DivisionResult[]> {
    const eventSlug = options.eventSlug ?? "2026-reno-memorial-day-tournament";
    const config = await this.fetchScheduleConfig(eventId, eventSlug);
    const divisionsById = new Map(
      config.divisions.map((division) => [String(division.Id), division]),
    );
    const resultBrackets = selectResultBrackets(config.brackets, divisionsById);
    const resultBracketDivisionIds = new Set(
      resultBrackets.map((bracket) => String(bracket.DivisionId)),
    );
    const results = new Map<string, DivisionResult>();

    for (const bracket of resultBrackets) {
      const division = divisionsById.get(String(bracket.DivisionId));
      if (!division) continue;
      const url = new URL(
        `/${eventId}/${eventSlug}/bracket/${bracket.Id}`,
        this.baseUrl,
      ).toString();
      const html = await this.fetchText(url);
      addDivisionResults(
        results,
        parseBracketPlacementResults({
          html,
          url,
          eventId,
          divisionId: String(division.Id),
          divisionName: division.Name,
          bracketId: String(bracket.Id),
          bracketName: bracket.Name,
        }),
      );
      await sleep(Number(process.env.EXPOSURE_PUBLIC_REQUEST_DELAY_MS ?? 125));
    }

    for (const division of config.divisions) {
      const hasBracketResults = hasAnyDivisionResult(
        results,
        eventId,
        String(division.Id),
      );
      if (
        hasBracketResults &&
        hasDivisionPlacement(results, eventId, String(division.Id), 3)
      )
        continue;
      if (
        !hasBracketResults &&
        resultBracketDivisionIds.has(String(division.Id))
      )
        continue;
      const standings = await this.fetchDivisionStandings(
        eventId,
        eventSlug,
        String(division.Id),
      );
      const standingResults = parseStandingPlacementResults({
        standings,
        eventId,
        eventSlug,
        divisionId: String(division.Id),
        divisionName: division.Name,
        baseUrl: this.baseUrl,
      });
      if (hasBracketResults) {
        addCompatibleStandingBronze(
          results,
          standingResults,
          eventId,
          String(division.Id),
        );
      } else {
        addDivisionResults(results, standingResults);
      }
      await sleep(Number(process.env.EXPOSURE_PUBLIC_REQUEST_DELAY_MS ?? 125));
    }

    return Array.from(results.values()).sort(
      (left, right) =>
        left.divisionName.localeCompare(right.divisionName, "en-US", {
          numeric: true,
          sensitivity: "base",
        }) || left.placement - right.placement,
    );
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

  private async fetchTeamGames(
    eventId: number,
    eventSlug: string,
    teamIds: string[],
    bracketsByDivision: Map<string, PublicExposureBracketLink[]>,
    timezone: string,
  ): Promise<Game[]> {
    const gamesByTeam = await mapWithConcurrency(
      teamIds,
      positiveInteger(process.env.EXPOSURE_PUBLIC_TEAM_GAMES_CONCURRENCY, 4),
      async (teamId) => {
        const games: Game[] = [];
        const rawGroups = await this.fetchTeamGamesForTeam(eventId, teamId);
        for (const group of rawGroups) {
          if (!Array.isArray(group.Games)) continue;
          for (const rawGame of group.Games) {
            const mapped = mapPublicExposureGame(
              rawGame,
              eventId,
              bracketsByDivision.get(String(rawGame.DivisionId)) ?? [],
              eventSlug,
              this.baseUrl,
              timezone,
            );
            if (mapped) games.push(mapped);
          }
        }
        await sleep(
          Number(process.env.EXPOSURE_PUBLIC_REQUEST_DELAY_MS ?? 125),
        );
        return games;
      },
    );
    const deduped = new Map<string, Game>();
    for (const game of gamesByTeam.flat()) {
      deduped.set(game.exposureGameId ?? game.id, game);
    }
    return Array.from(deduped.values());
  }

  private async fetchTeamGamesForTeam(eventId: number, teamId: string) {
    const url = `${this.baseUrl}/${eventId}/e/teamgames?divisionteamid=${encodeURIComponent(teamId)}`;
    const response = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent":
          "CourtWatchAAU/0.1 (+independent companion tracker; respectful cache-backed polling)",
      },
      body: "",
    });
    if (!response.ok)
      throw new Error(
        `Public teamgames request failed with ${response.status} for team ${teamId}`,
      );
    return (await response.json()) as PublicExposureGameGroup[];
  }

  private async fetchDivisionStandings(
    eventId: number,
    eventSlug: string,
    divisionId: string,
  ) {
    const url = `${this.baseUrl}/${eventId}/${eventSlug}/standings?eventid=${eventId}&divisionId=${divisionId}`;
    const response = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent":
          "CourtWatchAAU/0.1 (+independent companion tracker; respectful cache-backed polling)",
      },
      body: new URLSearchParams({ divisionId }).toString(),
    });
    if (!response.ok)
      throw new Error(
        `Public standings request failed with ${response.status} for division ${divisionId}`,
      );
    return (await response.json()) as PublicExposureStandingPool[];
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
  divisionId: string;
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

interface PublicExposureStandingPool {
  PoolName?: string;
  Teams?: PublicExposureStandingTeam[];
}

interface PublicExposureStandingTeam {
  Name?: string | null;
  TeamLink?: string | null;
  Place?: string | null;
  Complete?: boolean | null;
  Wins?: number | null;
  Losses?: number | null;
  PointsScored?: number | null;
  PointsAllowed?: number | null;
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
        divisionId,
        url: new URL(
          `/${eventId}/${eventSlug}/bracket/${bracket.Id}`,
          baseUrl,
        ).toString(),
      },
    ]);
  }
  return grouped;
}

function parseBracketPlacementResults(input: {
  html: string;
  url: string;
  eventId: number;
  divisionId: string;
  divisionName: string;
  bracketId: string;
  bracketName: string;
}): DivisionResult[] {
  const $ = cheerio.load(input.html);
  const meta = extractDivisionMeta(input.divisionName);
  const results = new Map<ResultPlacement, DivisionResult>();
  const now = new Date().toISOString();
  const bracketGames = parseBracketGames($, input.eventId, input.url);

  $(".bracket-winner").each((_, element) => {
    const node = $(element);
    const text = cleanText(node.text());
    const placement = placementFromText(text);
    if (!placement) return;

    const team = bracketTeamFromNode(node, input.eventId, input.url);
    if (!team) return;
    results.set(
      placement,
      makePublicBracketResult({
        input,
        meta,
        team,
        placement,
        placementText: text,
        now,
      }),
    );
  });

  const champion = results.get(1);
  if (champion && !results.has(2)) {
    const finalGame = bracketGames
      .filter((game) =>
        game.teams.some((team) => bracketTeamMatchesResult(team, champion)),
      )
      .filter((game) => game.teams.length === 2)
      .sort(compareBracketGamesForFinal)[0];
    const runnerUp =
      finalGame?.teams.find(
        (team) => !bracketTeamMatchesResult(team, champion),
      ) ?? null;
    const championTeam =
      finalGame?.teams.find((team) =>
        bracketTeamMatchesResult(team, champion),
      ) ?? null;
    if (
      runnerUp &&
      (!hasScores(finalGame) ||
        !championTeam ||
        championTeam.score === null ||
        runnerUp.score === null ||
        championTeam.score > runnerUp.score)
    ) {
      results.set(
        2,
        makePublicBracketResult({
          input,
          meta,
          team: runnerUp,
          placement: 2,
          placementText: "Runner-up from official bracket final",
          finalGame,
          now,
        }),
      );
    }
  }

  const runnerUp = results.get(2);
  if (champion && runnerUp && !results.has(3)) {
    const bronze = inferBracketBronzeTeam(bracketGames, champion, runnerUp);
    if (bronze) {
      results.set(
        3,
        makePublicBracketResult({
          input,
          meta,
          team: bronze.team,
          placement: 3,
          placementText: "Bronze inferred from official bracket path",
          finalGame: bronze.game,
          now,
        }),
      );
    }
  }

  return Array.from(results.values()).sort(
    (left, right) => left.placement - right.placement,
  );
}

function makePublicBracketResult(input: {
  input: {
    url: string;
    eventId: number;
    divisionId: string;
    divisionName: string;
    bracketId: string;
    bracketName: string;
  };
  meta: ReturnType<typeof extractDivisionMeta>;
  team: ParsedBracketTeam;
  placement: ResultPlacement;
  placementText: string;
  finalGame?: ParsedBracketGame;
  now: string;
}): DivisionResult {
  const divisionId = `division-${input.input.eventId}-${input.input.divisionId}`;
  const rawJson = {
    source: "public_bracket_page",
    OfficialPlacement: true,
    DivisionId: input.input.divisionId,
    DivisionTeamId: input.team.divisionTeamId,
    BracketId: input.input.bracketId,
    BracketName: input.input.bracketName,
    BracketUrl: input.input.url,
    PlacementText: input.placementText,
    FinalGameNumber: input.finalGame?.gameNumber ?? null,
    FinalGameScores:
      input.finalGame?.teams.map((team) => ({
        name: team.name,
        score: team.score,
      })) ?? null,
  };
  const sourceHash = hashSource({
    placement: input.placement,
    teamId: input.team.teamId,
    teamNameSnapshot: input.team.name,
    sourceUrl: input.input.url,
    rawJson,
  });

  return {
    id: `public-result-${input.input.eventId}-${input.input.divisionId}-${input.placement}`,
    eventId: `event-${input.input.eventId}`,
    divisionId,
    divisionName: input.input.divisionName,
    gender: input.meta.gender,
    gradeLevel: input.meta.gradeLevel,
    level: input.meta.level,
    teamId: input.team.teamId,
    teamNameSnapshot: input.team.name,
    teamSourceUrl: input.team.sourceUrl,
    placement: input.placement,
    medalLabel: placementMedals[input.placement],
    bracketLabel: input.input.bracketName,
    source: "bracket_final",
    sourceUrl: input.input.url,
    isOfficial: true,
    sourceHash,
    rawJson,
    lastSeenAt: input.now,
  };
}

interface ParsedBracketTeam {
  name: string;
  href: string | null;
  sourceUrl: string | null;
  divisionTeamId: string | null;
  teamId: string | null;
  score: number | null;
}

interface ParsedBracketGame {
  left: number;
  top: number;
  gameNumber: number;
  teams: ParsedBracketTeam[];
}

function parseBracketGames(
  $: cheerio.CheerioAPI,
  eventId: number,
  baseUrl: string,
): ParsedBracketGame[] {
  const games: ParsedBracketGame[] = [];
  $(".bracket-part").each((_, element) => {
    const node = $(element);
    const teams: ParsedBracketTeam[] = [];
    node.find(".away-team, .home-team").each((__, teamElement) => {
      const team = bracketTeamFromNode($(teamElement), eventId, baseUrl);
      if (team) teams.push(team);
    });
    if (teams.length === 0) return;
    games.push({
      left: stylePixelValue(node.attr("style"), "left"),
      top: stylePixelValue(node.attr("style"), "top"),
      gameNumber:
        Number(cleanText(node.find(".game-number .number").first().text())) ||
        0,
      teams,
    });
  });
  return games;
}

function bracketTeamFromNode(
  node: cheerio.Cheerio<AnyNode>,
  eventId: number,
  baseUrl: string,
): ParsedBracketTeam | null {
  const name = cleanText(node.find(".name").first().text());
  if (!name) return null;
  if (isBracketPlaceholderTeamName(name)) return null;
  const href = node.find("a").first().attr("href") ?? null;
  const sourceUrl = href ? new URL(href, baseUrl).toString() : null;
  const divisionTeamId = href
    ? new URL(href, baseUrl).searchParams.get("divisionteamid")
    : null;
  return {
    name,
    href,
    sourceUrl,
    divisionTeamId,
    teamId: divisionTeamId ? `public-team-${eventId}-${divisionTeamId}` : null,
    score: scoreFromBracketParticipantText(cleanText(node.text())),
  };
}

function scoreFromBracketParticipantText(text: string): number | null {
  const scores = Array.from(text.matchAll(/\((\d{1,3})\)/g));
  const rawScore = scores.at(-1)?.[1];
  return rawScore ? sanitizeBasketballScore(Number(rawScore)) : null;
}

function isBracketPlaceholderTeamName(name: string): boolean {
  const normalized = cleanText(name).toLowerCase();
  return (
    /^(w|l)\d+(\s*\([^)]*\))?$/.test(normalized) ||
    /^(winner|loser)\s+(of\s+)?(game\s+)?\d+$/i.test(normalized) ||
    /^(tbd|to be determined|bye)$/.test(normalized)
  );
}

function stylePixelValue(
  style: string | null | undefined,
  key: string,
): number {
  const match = style?.match(new RegExp(`${key}\\s*:\\s*(-?\\d+)px`, "i"));
  return match?.[1] ? Number(match[1]) : 0;
}

function bracketTeamMatchesResult(
  team: ParsedBracketTeam,
  result: DivisionResult,
): boolean {
  return Boolean(
    (team.teamId && result.teamId && team.teamId === result.teamId) ||
    normalizeName(team.name) === normalizeName(result.teamNameSnapshot),
  );
}

function compareBracketGamesForFinal(
  left: ParsedBracketGame,
  right: ParsedBracketGame,
): number {
  return (
    right.left - left.left ||
    right.gameNumber - left.gameNumber ||
    right.top - left.top
  );
}

function hasScores(game: ParsedBracketGame | undefined): boolean {
  return Boolean(game?.teams.every((team) => team.score !== null));
}

function inferBracketBronzeTeam(
  games: ParsedBracketGame[],
  champion: DivisionResult,
  runnerUp: DivisionResult,
): { team: ParsedBracketTeam; game: ParsedBracketGame } | null {
  const candidates = new Map<
    string,
    {
      team: ParsedBracketTeam;
      game: ParsedBracketGame;
      count: number;
      lostToChampion: boolean;
      margin: number;
    }
  >();

  for (const game of games) {
    if (game.teams.length !== 2 || !hasScores(game)) continue;
    const winner = gameWinnerTeam(game);
    const loser = gameLoserTeam(game);
    if (!winner || !loser) continue;
    const winnerIsChampion = bracketTeamMatchesResult(winner, champion);
    const winnerIsRunnerUp = bracketTeamMatchesResult(winner, runnerUp);
    if (!winnerIsChampion && !winnerIsRunnerUp) continue;
    if (
      bracketTeamMatchesResult(loser, champion) ||
      bracketTeamMatchesResult(loser, runnerUp)
    )
      continue;

    const key = loser.teamId ?? normalizeName(loser.name);
    const existing = candidates.get(key);
    const margin = Math.abs((winner.score ?? 0) - (loser.score ?? 0));
    const lostToChampion = winnerIsChampion;
    if (!existing) {
      candidates.set(key, {
        team: loser,
        game,
        count: 1,
        lostToChampion,
        margin,
      });
      continue;
    }
    existing.count += 1;
    if (
      Number(lostToChampion) > Number(existing.lostToChampion) ||
      (lostToChampion === existing.lostToChampion &&
        (margin < existing.margin ||
          (margin === existing.margin &&
            compareBracketGamesForFinal(game, existing.game) < 0)))
    ) {
      existing.game = game;
      existing.lostToChampion = lostToChampion;
      existing.margin = margin;
    }
  }

  return (
    Array.from(candidates.values()).sort(
      (left, right) =>
        right.count - left.count ||
        Number(right.lostToChampion) - Number(left.lostToChampion) ||
        left.margin - right.margin ||
        compareBracketGamesForFinal(left.game, right.game),
    )[0] ?? null
  );
}

function gameWinnerTeam(game: ParsedBracketGame): ParsedBracketTeam | null {
  const [left, right] = game.teams;
  if (!left || !right || left.score === null || right.score === null)
    return null;
  if (left.score === right.score) return null;
  return left.score > right.score ? left : right;
}

function gameLoserTeam(game: ParsedBracketGame): ParsedBracketTeam | null {
  const [left, right] = game.teams;
  if (!left || !right || left.score === null || right.score === null)
    return null;
  if (left.score === right.score) return null;
  return left.score < right.score ? left : right;
}

function addDivisionResults(
  results: Map<string, DivisionResult>,
  nextResults: DivisionResult[],
) {
  for (const result of nextResults) {
    const key = divisionResultKey(result);
    if (!results.has(key)) results.set(key, result);
  }
}

function hasAnyDivisionResult(
  results: Map<string, DivisionResult>,
  eventId: number,
  divisionId: string,
): boolean {
  const mappedDivisionId = `division-${eventId}-${divisionId}`;
  return Array.from(results.keys()).some((key) =>
    key.startsWith(`${mappedDivisionId}:`),
  );
}

function hasDivisionPlacement(
  results: Map<string, DivisionResult>,
  eventId: number,
  divisionId: string,
  placement: ResultPlacement,
): boolean {
  return results.has(`division-${eventId}-${divisionId}:${placement}`);
}

function addCompatibleStandingBronze(
  results: Map<string, DivisionResult>,
  standingResults: DivisionResult[],
  eventId: number,
  divisionId: string,
) {
  if (hasDivisionPlacement(results, eventId, divisionId, 3)) return;
  const mappedDivisionId = `division-${eventId}-${divisionId}`;
  const bracketGold = results.get(`${mappedDivisionId}:1`);
  const bracketSilver = results.get(`${mappedDivisionId}:2`);
  const standingGold = standingResults.find((result) => result.placement === 1);
  const standingSilver = standingResults.find(
    (result) => result.placement === 2,
  );
  const standingBronze = standingResults.find(
    (result) => result.placement === 3,
  );
  if (
    bracketGold &&
    bracketSilver &&
    standingGold &&
    standingSilver &&
    standingBronze &&
    resultsMatchTeam(bracketGold, standingGold) &&
    resultsMatchTeam(bracketSilver, standingSilver)
  ) {
    addDivisionResults(results, [standingBronze]);
  }
}

function resultsMatchTeam(
  left: DivisionResult,
  right: DivisionResult,
): boolean {
  return Boolean(
    (left.teamId && right.teamId && left.teamId === right.teamId) ||
    normalizeName(left.teamNameSnapshot) ===
      normalizeName(right.teamNameSnapshot),
  );
}

function divisionResultKey(result: DivisionResult): string {
  return `${result.divisionId}:${result.placement}`;
}

function selectResultBrackets(
  brackets: PublicExposureScheduleConfig["brackets"],
  divisionsById: Map<string, { Id: number; Name: string }>,
) {
  const grouped = new Map<string, PublicExposureScheduleConfig["brackets"]>();
  for (const bracket of brackets) {
    const divisionId = String(bracket.DivisionId);
    grouped.set(divisionId, [...(grouped.get(divisionId) ?? []), bracket]);
  }

  const selected: PublicExposureScheduleConfig["brackets"] = [];
  for (const [divisionId, divisionBrackets] of grouped.entries()) {
    const primary = divisionBrackets.filter((bracket) =>
      isPrimaryResultBracketName(bracket.Name),
    );
    selected.push(
      ...(primary.length > 0
        ? primary
        : divisionBrackets.filter((bracket) =>
            isFallbackResultBracketName(
              bracket.Name,
              divisionsById.get(divisionId)?.Name ?? "",
            ),
          )),
    );
  }

  return selected;
}

function isFallbackResultBracketName(
  bracketName: string,
  divisionName: string,
): boolean {
  const normalized = normalizeName(bracketName);
  if (!normalized) return false;
  if (
    ["consolation", "play in"].some((blocked) => normalized.includes(blocked))
  )
    return false;
  if (
    ["silver", "bronze"].some((blocked) => normalized === blocked) &&
    !normalizeName(divisionName).includes(normalized)
  )
    return false;
  return (
    normalized.includes("playoff") ||
    normalized.includes("championship") ||
    normalized.includes("gold") ||
    normalized === "bracket"
  );
}

function parseStandingPlacementResults(input: {
  standings: PublicExposureStandingPool[];
  eventId: number;
  eventSlug: string;
  divisionId: string;
  divisionName: string;
  baseUrl: string;
}): DivisionResult[] {
  const meta = extractDivisionMeta(input.divisionName);
  const sourceUrl = new URL(
    `/${input.eventId}/${input.eventSlug}/standings?eventid=${input.eventId}&divisionId=${input.divisionId}`,
    input.baseUrl,
  ).toString();
  const now = new Date().toISOString();
  const results = new Map<string, DivisionResult>();
  const completedPools = input.standings.filter((pool) => {
    const teams = pool.Teams ?? [];
    return teams.length > 0 && teams.every((team) => team.Complete === true);
  });
  const usePoolGroups = completedPools.length > 1;

  for (const pool of completedPools) {
    const poolName = cleanText(pool.PoolName) || "Pool";
    const poolKey = normalizePoolKey(poolName);
    const resultDivisionId = usePoolGroups
      ? `division-${input.eventId}-${input.divisionId}-pool-${poolKey}`
      : `division-${input.eventId}-${input.divisionId}`;
    const resultDivisionName = usePoolGroups
      ? `${input.divisionName} - Pool ${poolName}`
      : input.divisionName;
    const bracketLabel = usePoolGroups
      ? `Pool ${poolName} standings`
      : "Standings";

    for (const team of pool.Teams ?? []) {
      const placement = placementFromText(String(team.Place ?? ""));
      if (!placement) continue;
      const name = cleanText(team.Name);
      if (!name) continue;
      const href = stringOrNull(team.TeamLink);
      const teamSourceUrl = href
        ? new URL(href, input.baseUrl).toString()
        : null;
      const divisionTeamId = href
        ? new URL(href, input.baseUrl).searchParams.get("divisionteamid")
        : null;
      const teamId = divisionTeamId
        ? `public-team-${input.eventId}-${divisionTeamId}`
        : null;
      const rawJson = {
        source: "public_standings",
        OfficialPlacement: true,
        DivisionId: input.divisionId,
        SyntheticDivisionId: resultDivisionId,
        SyntheticDivisionName: resultDivisionName,
        PoolName: usePoolGroups ? poolName : null,
        PoolKey: usePoolGroups ? poolKey : null,
        DivisionTeamId: divisionTeamId,
        TeamLink: href,
        Place: team.Place,
        Wins: team.Wins,
        Losses: team.Losses,
        PointsScored: team.PointsScored,
        PointsAllowed: team.PointsAllowed,
      };
      const sourceHash = hashSource({
        placement,
        teamId,
        teamNameSnapshot: name,
        sourceUrl,
        rawJson,
      });

      results.set(`${resultDivisionId}:${placement}`, {
        id: `public-standings-result-${input.eventId}-${input.divisionId}-${poolKey}-${placement}`,
        eventId: `event-${input.eventId}`,
        divisionId: resultDivisionId,
        divisionName: resultDivisionName,
        gender: meta.gender,
        gradeLevel: meta.gradeLevel,
        level: meta.level,
        teamId,
        teamNameSnapshot: name,
        teamSourceUrl,
        placement,
        medalLabel: placementMedals[placement],
        bracketLabel,
        source: "official_standings",
        sourceUrl,
        isOfficial: true,
        sourceHash,
        rawJson,
        lastSeenAt: now,
      });
    }
  }

  return Array.from(results.values()).sort(
    (left, right) =>
      left.divisionName.localeCompare(right.divisionName, "en-US", {
        numeric: true,
        sensitivity: "base",
      }) || left.placement - right.placement,
  );
}

function normalizePoolKey(poolName: string): string {
  return normalizeName(poolName).replace(/[^a-z0-9]+/g, "-") || "pool";
}

function isPrimaryResultBracketName(name: string): boolean {
  const normalized = normalizeName(name);
  return ["championship", "gold"].includes(normalized);
}

function placementFromText(text: string): ResultPlacement | null {
  const normalized = text.toLowerCase();
  if (/\bchampion\b/.test(normalized)) return 1;
  if (/^\s*(1st|first)\s*$/.test(normalized)) return 1;
  if (/^\s*(2nd|second)\s*$/.test(normalized)) return 2;
  if (/^\s*(3rd|third)\s*$/.test(normalized)) return 3;
  if (/\b(1st|first)\s+place\b/.test(normalized)) return 1;
  if (/\b(2nd|second)\s+place\b/.test(normalized)) return 2;
  if (/\b(3rd|third)\s+place\b/.test(normalized)) return 3;
  return null;
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
  return sanitizeBasketballScore(Number(text));
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
  if (raw.Started)
    return deriveEffectiveGameStatus({
      startsAt: startsAt.toISOString(),
      status: "playing_now",
    });
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

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(
          items[currentIndex]!,
          currentIndex,
        );
      }
    }),
  );
  return results;
}

function sleep(ms: number) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
