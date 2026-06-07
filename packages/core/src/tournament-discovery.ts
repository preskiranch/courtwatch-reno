import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { extractDivisionMeta, normalizeName } from "./normalization.js";
import {
  PublicExposurePageClient,
  type PublicExposureTeamResult,
} from "./public-exposure-page-client.js";
import { californiaTournamentRegionFromPlace } from "./california-region.js";
import type { TournamentEvent, TournamentEventStatus } from "./types.js";
import { DEFAULT_TOURNAMENT_TIMEZONE } from "./types.js";
import {
  deriveTournamentStatus,
  tournamentDedupeKey,
  tournamentTodayKey,
  tournamentWindowEndKey,
} from "./tournament-eligibility.js";
import { isCourtWatchSupportedTournamentRegion } from "./tournament-region-scope.js";

export type TournamentProviderName =
  | "exposure_events"
  | "public_html"
  | "aau_event_finder";

export interface MajorTournamentSource {
  name: string;
  provider: TournamentProviderName;
  enabled: boolean;
  url?: string;
  eventUrls?: string[];
  eventLinkPatterns?: string[];
  teamListUrlTemplates?: string[];
  teamListLinkPatterns?: string[];
  teamSelectors?: string[];
  maxEvents?: number;
  maxTeamListPages?: number;
  metadataOnly?: boolean;
  directoryEventType?: string;
  ignoreDiscoveryWindowEnd?: boolean;
  organizerName?: string;
  sanctioningTags?: string[];
  timezone?: string;
  region?: string;
}

export interface TournamentDiscoveryWindow {
  startDate: string;
  endDate: string;
  now?: Date;
}

export interface DiscoveredTournamentEvent extends TournamentEvent {
  dropdownGroup: "upcoming";
}

export interface PublicTournamentCandidate {
  event: DiscoveredTournamentEvent;
  teams: PublicExposureTeamResult;
}

export interface TournamentProviderFailure {
  provider: string;
  source: string;
  message: string;
}

export interface TournamentDiscoveryResult {
  candidates: PublicTournamentCandidate[];
  failures: TournamentProviderFailure[];
}

export interface TournamentProvider {
  providerName: TournamentProviderName;
  supportsPublicTeamLists: boolean;
  discoverEvents(
    source: MajorTournamentSource,
    window: TournamentDiscoveryWindow,
  ): Promise<DiscoveredTournamentEvent[]>;
  fetchRegisteredTeams(
    event: DiscoveredTournamentEvent,
  ): Promise<PublicExposureTeamResult>;
}

interface ExposureDirectoryPayload {
  Results?: Array<Record<string, unknown>> | null;
  Page?: number | string | null;
  PageSize?: number | string | null;
  Total?: number | string | null;
  TotalPages?: number | string | null;
}

const GSG_BAM_EXPOSURE_EVENT_URLS = [
  "https://basketball.exposureevents.com/248676/gsg-x-bam-new-years-tip-off",
  "https://basketball.exposureevents.com/248677/bam-x-gsg-battleground-showcase",
  "https://basketball.exposureevents.com/248678/gsg-x-bam-mlk-tournament",
  "https://basketball.exposureevents.com/259691/gsg-x-bam-winter-shootout",
  "https://basketball.exposureevents.com/259692/bam-x-gsg-winter-hoopfest",
  "https://basketball.exposureevents.com/259694/gsg-x-bam-super-bowl-slam",
  "https://basketball.exposureevents.com/259695/bam-x-gsg-golden-state-tip-off",
  "https://basketball.exposureevents.com/259696/gsg-x-bam-bay-area-hoop-challenge",
  "https://basketball.exposureevents.com/259697/king-of-the-bay-powered-by-battleground-x-lakeshow",
  "https://basketball.exposureevents.com/259698/gsg-x-bam-west-coast-rumble",
  "https://basketball.exposureevents.com/259699/king-of-sonoma-county-powered-by-battlegrounds-circuit",
  "https://basketball.exposureevents.com/259700/bam-x-gsg-bay-area-hoop-cup",
  "https://basketball.exposureevents.com/262153/bam-x-gsg-march-madness",
  "https://basketball.exposureevents.com/262156/gsg-x-bam-easter-jam",
  "https://basketball.exposureevents.com/262158/bam-x-gsg-hoop-supremacy",
  "https://basketball.exposureevents.com/262159/gsg-x-bam-bay-area-spring-jam",
  "https://basketball.exposureevents.com/262160/bam-x-gsg-bayside-battle",
  "https://basketball.exposureevents.com/262161/gsg-x-bam-bay-area-jamboree",
  "https://basketball.exposureevents.com/262163/bam-x-gsg-mothers-day-shootout",
  "https://basketball.exposureevents.com/262164/king-of-norcal-powered-by-battleground-circuit",
  "https://basketball.exposureevents.com/262358/memorial-day-mayhem-powered-by-4ballers-only-and-battleground-circuit",
  "https://basketball.exposureevents.com/264312/bam-x-gsg-spring-finale",
  "https://basketball.exposureevents.com/264313/gsg-x-bam-norcal-collision",
  "https://basketball.exposureevents.com/264314/the-east-bay-summer-battle-powered-by-4ballers-only-x-gsg-x-justhoop",
  "https://basketball.exposureevents.com/264315/gsg-x-bam-fathers-day-shootout",
  "https://basketball.exposureevents.com/264316/bam-x-gsg-summer-slam",
  "https://basketball.exposureevents.com/264317/gsg-x-bam-july-4th-shootout",
  "https://basketball.exposureevents.com/264318/bam-x-gsg-norcal-summer-classic",
  "https://basketball.exposureevents.com/264319/gsg-x-bam-summer-showdown",
  "https://basketball.exposureevents.com/264320/bam-x-gsg-summer-jam",
  "https://basketball.exposureevents.com/264321/gsg-x-bam-summer-showcase",
  "https://basketball.exposureevents.com/264322/king-of-cali-powered-by-battleground-circuit",
  "https://basketball.exposureevents.com/264323/bam-x-gsg-bay-area-hoopfest",
  "https://basketball.exposureevents.com/264324/gsg-x-bam-heat-check-classic",
  "https://basketball.exposureevents.com/264325/bam-x-gsg-summer-finale",
];

export const DEFAULT_MAJOR_TOURNAMENT_SOURCES: MajorTournamentSource[] = [
  {
    name: "Jam On It",
    provider: "exposure_events",
    enabled: true,
    url: "https://basketball.exposureevents.com/organizations/3461/jam-on-it",
    eventUrls: [
      "https://basketball.exposureevents.com/256931/2026-the-battleground",
      "https://basketball.exposureevents.com/255723/2026-las-vegas-showtime",
      "https://basketball.exposureevents.com/255725/2026-grand-finale",
    ],
    organizerName: "Jam On It",
    sanctioningTags: ["Jam On It", "Exposure Events"],
    timezone: DEFAULT_TOURNAMENT_TIMEZONE,
  },
  {
    name: "Grassroots 365",
    provider: "exposure_events",
    enabled: true,
    url: "https://basketball.exposureevents.com/organizations/21530/grassroots-365",
    eventUrls: [
      "https://basketball.exposureevents.com/252014/g365-memorial-day-challenge",
      "https://basketball.exposureevents.com/252017/g365-kings-of-the-south",
      "https://basketball.exposureevents.com/252018/g365-sactown-swish",
      "https://basketball.exposureevents.com/252627/g365-extravaganza",
      "https://basketball.exposureevents.com/252628/g365-gold-rush",
      "https://basketball.exposureevents.com/252629/g365-dance-in-the-desert",
      "https://basketball.exposureevents.com/252630/g365-battle-in-the-valley",
      "https://basketball.exposureevents.com/252631/g365-underground-classic",
      "https://basketball.exposureevents.com/252632/g365-dallas-skyline-classic",
      "https://basketball.exposureevents.com/252634/g365-jet-city",
      "https://basketball.exposureevents.com/252635/g365-the-finals",
      "https://basketball.exposureevents.com/252637/g365-nationals",
      "https://basketball.exposureevents.com/252638/g365-vegas-marquee",
      "https://basketball.exposureevents.com/252639/g365-crown-city-classic",
      "https://basketball.exposureevents.com/252640/g365-summer-slam",
      "https://basketball.exposureevents.com/252641/g365-sea-town-slam",
      "https://basketball.exposureevents.com/252644/g365-the-crown",
      "https://basketball.exposureevents.com/252645/g365-the-rise",
      "https://basketball.exposureevents.com/252647/g365-summer-showdown",
    ],
    maxEvents: 80,
    organizerName: "Grassroots 365",
    sanctioningTags: ["Grassroots 365", "Exposure Events"],
    timezone: DEFAULT_TOURNAMENT_TIMEZONE,
  },
  {
    name: "Zero Gravity Basketball",
    provider: "exposure_events",
    enabled: false,
    url: "https://basketball.exposureevents.com/organizations/18316/zero-gravity-basketball",
    eventUrls: [
      "https://basketball.exposureevents.com/260505/zero-gravity-hoops-challenge",
      "https://basketball.exposureevents.com/259635/zero-gravity-the-challenge-ny",
      "https://basketball.exposureevents.com/258791/zero-gravity-the-summer-stage",
      "https://basketball.exposureevents.com/260323/zero-gravity-run-for-the-races",
    ],
    organizerName: "Zero Gravity Basketball",
    sanctioningTags: ["Zero Gravity", "Exposure Events"],
    timezone: DEFAULT_TOURNAMENT_TIMEZONE,
  },
  {
    name: "GSG Hoops",
    provider: "exposure_events",
    enabled: true,
    url: "https://basketball.exposureevents.com/organizations/33328/gsg-hoops",
    eventUrls: GSG_BAM_EXPOSURE_EVENT_URLS,
    maxEvents: 60,
    organizerName: "GSG Hoops",
    sanctioningTags: [
      "GSG Hoops",
      "Golden State Games",
      "BAM x GSG",
      "Exposure Events",
    ],
    timezone: DEFAULT_TOURNAMENT_TIMEZONE,
    region: "California",
  },
  {
    name: "BAMTOURNAMENTS",
    provider: "exposure_events",
    enabled: true,
    url: "https://basketball.exposureevents.com/organizations/27132/bamtournaments",
    eventUrls: GSG_BAM_EXPOSURE_EVENT_URLS,
    maxEvents: 60,
    organizerName: "BAMTOURNAMENTS",
    sanctioningTags: [
      "BAM",
      "BAMTOURNAMENTS",
      "BAM Tournaments",
      "BAM x GSG",
      "Exposure Events",
    ],
    timezone: DEFAULT_TOURNAMENT_TIMEZONE,
    region: "California",
  },
  {
    name: "Touch Shooting Premiere Events",
    provider: "exposure_events",
    enabled: true,
    url: "https://basketball.exposureevents.com/organizations/33845/touch-shooting-premiere-events",
    eventUrls: ["https://basketball.exposureevents.com/267048/the-standard"],
    organizerName: "Touch Shooting Premiere Events",
    sanctioningTags: [
      "Touch Shooting Premiere Events",
      "Northern California",
      "NorCal",
      "Exposure Events",
    ],
    timezone: DEFAULT_TOURNAMENT_TIMEZONE,
    region: "Northern California",
  },
  {
    name: "Hoop 121",
    provider: "exposure_events",
    enabled: true,
    url: "https://basketball.exposureevents.com/organizations/12589/hoop-121",
    eventUrls: [
      "https://basketball.exposureevents.com/247158/2026-fathers-day-hoop-fest",
      "https://basketball.exposureevents.com/262891/sf-whph-and-sf-rebels-sf-takeover",
      "https://basketball.exposureevents.com/255459/the-bay-area-fall-fest-invitational",
    ],
    organizerName: "Hoop 121",
    sanctioningTags: [
      "Hoop 121",
      "Bay Area",
      "Northern California",
      "NorCal",
      "Exposure Events",
    ],
    timezone: DEFAULT_TOURNAMENT_TIMEZONE,
    region: "Northern California",
  },
  {
    name: "NorCal Sports TV",
    provider: "exposure_events",
    enabled: true,
    url: "https://basketball.exposureevents.com/organizations/27463/norcal-sports-tv",
    eventUrls: [
      "https://basketball.exposureevents.com/262086/ncstv-valley-exposure-tour",
    ],
    organizerName: "NorCal Sports TV",
    sanctioningTags: [
      "NorCal Sports TV",
      "Northern California",
      "NorCal",
      "Exposure Events",
    ],
    timezone: DEFAULT_TOURNAMENT_TIMEZONE,
    region: "Northern California",
  },
  {
    name: "Bay Area Stars Academy",
    provider: "exposure_events",
    enabled: true,
    url: "https://basketball.exposureevents.com/organizations/35401/bay-area-stars-academy",
    organizerName: "Bay Area Stars Academy",
    sanctioningTags: [
      "Bay Area Stars",
      "Bay Area",
      "Northern California",
      "NorCal",
      "Exposure Events",
    ],
    timezone: DEFAULT_TOURNAMENT_TIMEZONE,
    region: "Northern California",
  },
  {
    name: "Configured Public HTML Sources",
    provider: "public_html",
    enabled: true,
    eventUrls: [],
    organizerName: "Public Tournament Source",
    sanctioningTags: ["Public Source"],
    timezone: DEFAULT_TOURNAMENT_TIMEZONE,
  },
  {
    name: "Exposure Basketball Directory",
    provider: "aau_event_finder",
    enabled: false,
    url: "https://basketball.exposureevents.com/youth-basketball-events",
    maxEvents: 2600,
    metadataOnly: true,
    directoryEventType: "",
    ignoreDiscoveryWindowEnd: true,
    organizerName: "Exposure Basketball Events",
    sanctioningTags: ["Exposure Events"],
    timezone: DEFAULT_TOURNAMENT_TIMEZONE,
  },
];

export class TournamentDiscoveryService {
  private readonly providers: Map<TournamentProviderName, TournamentProvider>;

  constructor(
    providers: TournamentProvider[] = [
      new ExposureEventsTournamentProvider(),
      new PublicHtmlTournamentProvider(),
      new AauEventFinderTournamentProvider(),
    ],
  ) {
    this.providers = new Map(
      providers.map((provider) => [provider.providerName, provider]),
    );
  }

  async discover(
    sources: MajorTournamentSource[],
    options: { now?: Date; windowDays?: number } = {},
  ): Promise<TournamentDiscoveryResult> {
    const startDate = tournamentTodayKey(options.now);
    const endDate = tournamentWindowEndKey(startDate, options.windowDays);
    const candidates: PublicTournamentCandidate[] = [];
    const failures: TournamentProviderFailure[] = [];
    const seen = new Set<string>();

    for (const source of sources.filter((item) => item.enabled)) {
      const provider = this.providers.get(source.provider);
      if (!provider) {
        failures.push({
          provider: source.provider,
          source: source.name,
          message: "No provider adapter is registered for this source.",
        });
        continue;
      }

      try {
        const events = await provider.discoverEvents(source, {
          startDate,
          endDate,
          now: options.now,
        });
        let metadataTeamHydrations = 0;
        for (const event of events.filter(
          isCourtWatchSupportedTournamentRegion,
        )) {
          const keys = tournamentDiscoveryDedupeKeys(event);
          if (keys.some((key) => seen.has(key))) continue;
          for (const key of keys) seen.add(key);
          if (!provider.supportsPublicTeamLists) continue;

          if (source.metadataOnly) {
            const status = deriveTournamentStatus(event, startDate);
            if (
              shouldHydrateMetadataOnlyTeams(event, startDate) &&
              metadataTeamHydrations < metadataTeamHydrationLimit()
            ) {
              try {
                const teams = await provider.fetchRegisteredTeams(event);
                metadataTeamHydrations += 1;
                candidates.push({
                  event: {
                    ...event,
                    hasPublicTeamList: true,
                    registeredTeamCount: teams.teams.length,
                    lastCheckedAt: new Date().toISOString(),
                    lastSyncedAt: new Date().toISOString(),
                    status,
                  },
                  teams,
                });
                await sleep(
                  Number(
                    process.env.TOURNAMENT_DISCOVERY_REQUEST_DELAY_MS ?? 125,
                  ),
                );
                continue;
              } catch (error) {
                failures.push({
                  provider: provider.providerName,
                  source: event.sourceUrl,
                  message: errorMessage(error),
                });
              }
            }
            candidates.push({
              event: {
                ...event,
                lastCheckedAt: new Date().toISOString(),
                status,
              },
              teams: { divisions: [], teams: [] },
            });
            continue;
          }

          try {
            const teams = await provider.fetchRegisteredTeams(event);
            candidates.push({
              event: {
                ...event,
                hasPublicTeamList: true,
                registeredTeamCount: teams.teams.length,
                lastCheckedAt: new Date().toISOString(),
                lastSyncedAt: new Date().toISOString(),
                status: deriveTournamentStatus(event, startDate),
              },
              teams,
            });
          } catch (error) {
            failures.push({
              provider: provider.providerName,
              source: event.sourceUrl,
              message: errorMessage(error),
            });
          }

          await sleep(
            Number(process.env.TOURNAMENT_DISCOVERY_REQUEST_DELAY_MS ?? 125),
          );
        }
      } catch (error) {
        failures.push({
          provider: provider.providerName,
          source: source.url ?? source.name,
          message: errorMessage(error),
        });
      }
    }

    return { candidates, failures };
  }
}

export class ExposureEventsTournamentProvider implements TournamentProvider {
  readonly providerName = "exposure_events" as const;
  readonly supportsPublicTeamLists = true;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly publicClient: PublicExposurePageClient;

  constructor(options: { baseUrl?: string; fetchImpl?: typeof fetch } = {}) {
    this.baseUrl =
      options.baseUrl ??
      process.env.EXPOSURE_PUBLIC_BASE_URL ??
      "https://basketball.exposureevents.com";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.publicClient = new PublicExposurePageClient({
      baseUrl: this.baseUrl,
      fetchImpl: this.fetchImpl,
    });
  }

  async discoverEvents(
    source: MajorTournamentSource,
    window: TournamentDiscoveryWindow,
  ): Promise<DiscoveredTournamentEvent[]> {
    const eventUrls = new Set<string>();
    for (const eventUrl of source.eventUrls ?? []) {
      const normalized = normalizeExposureEventUrl(eventUrl, this.baseUrl);
      if (normalized) eventUrls.add(normalized);
    }

    if (source.url) {
      const sourceUrl = new URL(source.url, this.baseUrl).toString();
      const html = await this.fetchText(sourceUrl);
      for (const eventUrl of parseExposureEventLinks(html, this.baseUrl))
        eventUrls.add(eventUrl);
      for (const eventUrl of await this.fetchDirectoryEvents(
        sourceUrl,
        html,
        window,
        source,
      ))
        eventUrls.add(eventUrl);
    }

    const events: DiscoveredTournamentEvent[] = [];
    for (const eventUrl of eventUrls) {
      const parsed = parseExposureEventUrl(eventUrl);
      if (!parsed) continue;
      let details: DiscoveredTournamentEvent;
      try {
        details = await this.fetchEventDetails(eventUrl, source);
      } catch {
        // A stale explicit event link should not block the rest of an organizer.
        continue;
      }
      if (
        details.startDate > window.endDate ||
        details.endDate < window.startDate
      )
        continue;
      events.push(details);
      await sleep(
        Number(process.env.TOURNAMENT_DISCOVERY_REQUEST_DELAY_MS ?? 125),
      );
    }
    return dedupeDiscoveredEvents(events);
  }

  async fetchRegisteredTeams(
    event: DiscoveredTournamentEvent,
  ): Promise<PublicExposureTeamResult> {
    return this.publicClient.fetchTeams(
      event.exposureEventId,
      event.slug,
      event.timezone,
    );
  }

  private async fetchEventDetails(
    eventUrl: string,
    source: MajorTournamentSource,
  ): Promise<DiscoveredTournamentEvent> {
    const parsed = parseExposureEventUrl(eventUrl);
    if (!parsed) throw new Error(`Unsupported Exposure event URL: ${eventUrl}`);
    const html = await this.fetchText(eventUrl);
    const $ = cheerio.load(html);
    const title = cleanText(
      $("meta[property='og:title']").attr("content") || $("title").text(),
    );
    const twitterTitle = cleanText(
      $("meta[name='twitter:title']").attr("content") || "",
    );
    const description = cleanText(
      $("meta[property='og:description']").attr("content") ||
        $("meta[name='description']").attr("content") ||
        "",
    );
    const dateRange = parseDateRange(`${title} ${description}`);
    if (!dateRange)
      throw new Error(`Could not parse event date range from ${eventUrl}`);

    const name =
      twitterTitle ||
      stripTitleSuffix(title, dateRange.raw) ||
      `Exposure Event ${parsed.eventId}`;
    const location =
      parseLocationFromTitle(title, dateRange.raw) ||
      parseLocationFromDescription(description) ||
      "";
    const { city, state } = splitCityState(location);
    const organizer =
      cleanText($("a[href*='/organizations/']").first().text()) ||
      source.organizerName ||
      source.name;
    const bodyText = cleanText($("body").text());
    const status = bodyText.match(/\bcancelled\b/i)
      ? "cancelled"
      : deriveTournamentStatus({
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          status: "upcoming",
        });
    const sanctioningTags = dedupeStrings([
      ...(source.sanctioningTags ?? []),
      ...parseSanctioningTags(bodyText),
      "Exposure Events",
    ]);

    return {
      id: `event-${parsed.eventId}`,
      exposureEventId: parsed.eventId,
      externalProvider: this.providerName,
      externalId: String(parsed.eventId),
      slug: parsed.slug,
      sourceUrl: eventUrl,
      name,
      organizer,
      sport: "basketball",
      sanctioningTags,
      gender: parseGender(bodyText),
      ageOrGradeDivisions: parseAgeOrGradeDivisions(bodyText),
      venueName: parseVenueName($),
      city,
      state,
      region: tournamentRegionFromLocation(city, state, location, source),
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      location: location || [city, state].filter(Boolean).join(", "),
      officialUrl: eventUrl,
      timezone: source.timezone ?? DEFAULT_TOURNAMENT_TIMEZONE,
      registeredTeamCount: 0,
      hasPublicTeamList: false,
      lastCheckedAt: null,
      lastSyncedAt: null,
      lastTeamChangeAt: null,
      status,
      dropdownGroup: "upcoming",
    };
  }

  private async fetchDirectoryEvents(
    sourceUrl: string,
    html: string,
    window: TournamentDiscoveryWindow,
    source: MajorTournamentSource,
  ): Promise<string[]> {
    const token = parseExposureToken(html);
    if (!token) return [];
    await assertRobotsAllowed(sourceUrl, this.fetchImpl);
    const maxEvents = Math.max(1, source.maxEvents ?? 150);
    const eventUrls = new Set<string>();
    let page = 1;

    while (eventUrls.size < maxEvents) {
      const directoryEventType = source.directoryEventType ?? "Tournament";
      const body = new URLSearchParams({
        Page: String(page),
        sportType: "1",
        StartDateString: dateKeyToExposureDate(window.startDate),
      });
      if (!source.ignoreDiscoveryWindowEnd)
        body.set("EndDateString", dateKeyToExposureDate(window.endDate));
      if (directoryEventType) body.set("EventType", directoryEventType);
      const response = await this.fetchImpl(sourceUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Exposure-Token": token,
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent": publicUserAgent(),
        },
        body: body.toString(),
      });
      if (!response.ok)
        throw new Error(
          `Exposure directory request failed with ${response.status}`,
        );
      const payload = (await response.json()) as ExposureDirectoryPayload;
      const results = payload.Results ?? [];
      for (const item of results) {
        const value = stringValue(item.Link ?? item.Url ?? item.URL);
        const eventUrl = value
          ? normalizeExposureEventUrl(value, this.baseUrl)
          : null;
        if (eventUrl) eventUrls.add(eventUrl);
        if (eventUrls.size >= maxEvents) break;
      }
      if (!hasMoreExposureDirectoryPages(payload, page, results.length)) break;
      page += 1;
      await sleep(
        Number(process.env.TOURNAMENT_DISCOVERY_REQUEST_DELAY_MS ?? 125),
      );
    }

    return Array.from(eventUrls);
  }

  private async fetchText(url: string): Promise<string> {
    await assertRobotsAllowed(url, this.fetchImpl);
    const response = await this.fetchImpl(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": publicUserAgent(),
      },
    });
    if (!response.ok)
      throw new Error(
        `Public Exposure page request failed with ${response.status}`,
      );
    return response.text();
  }
}

function shouldHydrateMetadataOnlyTeams(
  event: DiscoveredTournamentEvent,
  startDate: string,
): boolean {
  const status = deriveTournamentStatus(event, startDate);
  if (status === "active") return true;
  if (status !== "upcoming") return false;
  return (
    event.startDate <=
    tournamentWindowEndKey(startDate, metadataTeamHydrationWindowDays())
  );
}

function metadataTeamHydrationWindowDays(): number {
  return positiveIntegerEnv(
    "TOURNAMENT_DISCOVERY_METADATA_TEAM_HYDRATION_WINDOW_DAYS",
    14,
  );
}

function metadataTeamHydrationLimit(): number {
  return positiveIntegerEnv(
    "TOURNAMENT_DISCOVERY_METADATA_TEAM_HYDRATION_LIMIT",
    300,
  );
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export class PublicHtmlTournamentProvider implements TournamentProvider {
  readonly providerName = "public_html" as const;
  readonly supportsPublicTeamLists = true;
  private readonly fetchImpl: typeof fetch;
  private readonly sourceByEventUrl = new Map<string, MajorTournamentSource>();

  constructor(options: { fetchImpl?: typeof fetch } = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async discoverEvents(
    source: MajorTournamentSource,
    window: TournamentDiscoveryWindow,
  ): Promise<DiscoveredTournamentEvent[]> {
    const eventUrls = new Set<string>();
    for (const eventUrl of source.eventUrls ?? [])
      eventUrls.add(normalizePublicUrl(eventUrl));

    if (source.url && (source.eventLinkPatterns?.length ?? 0) > 0) {
      const sourceUrl = normalizePublicUrl(source.url);
      const html = await this.fetchText(sourceUrl);
      for (const eventUrl of parsePublicHtmlEventLinks(
        html,
        sourceUrl,
        source.eventLinkPatterns ?? [],
      ))
        eventUrls.add(eventUrl);
    }

    const events: DiscoveredTournamentEvent[] = [];
    const maxEvents = Math.max(1, source.maxEvents ?? 25);
    for (const eventUrl of Array.from(eventUrls).slice(0, maxEvents)) {
      const details = await this.fetchEventDetails(eventUrl, source);
      if (
        details.startDate > window.endDate ||
        details.endDate < window.startDate
      )
        continue;
      this.sourceByEventUrl.set(details.sourceUrl, source);
      events.push(details);
      await sleep(
        Number(process.env.TOURNAMENT_DISCOVERY_REQUEST_DELAY_MS ?? 125),
      );
    }

    return dedupeDiscoveredEvents(events);
  }

  async fetchRegisteredTeams(
    event: DiscoveredTournamentEvent,
  ): Promise<PublicExposureTeamResult> {
    const source = this.sourceByEventUrl.get(event.sourceUrl);
    const eventHtml = await this.fetchText(event.sourceUrl);
    const teamListUrls = publicTeamListUrls(event.sourceUrl, eventHtml, source);
    const maxTeamListPages = Math.max(1, source?.maxTeamListPages ?? 20);
    let fetchedAnyTeamListPage = false;
    const divisions = new Map<
      string,
      PublicExposureTeamResult["divisions"][number]
    >();
    const teams = new Map<string, PublicExposureTeamResult["teams"][number]>();

    for (const teamListUrl of teamListUrls.slice(0, maxTeamListPages)) {
      const html = await this.fetchText(teamListUrl);
      if (!looksLikeTeamListPage(teamListUrl, html, source)) continue;
      fetchedAnyTeamListPage = true;
      const parsed = parsePublicHtmlTeams(html, event, teamListUrl, source);
      for (const division of parsed.divisions)
        divisions.set(division.id, division);
      for (const team of parsed.teams) teams.set(team.id, team);
      await sleep(
        Number(process.env.TOURNAMENT_DISCOVERY_REQUEST_DELAY_MS ?? 125),
      );
    }

    if (!fetchedAnyTeamListPage)
      throw new Error(
        "No reachable public team-list page was found for this event.",
      );
    return {
      divisions: Array.from(divisions.values()),
      teams: Array.from(teams.values()),
    };
  }

  private async fetchEventDetails(
    eventUrl: string,
    source: MajorTournamentSource,
  ): Promise<DiscoveredTournamentEvent> {
    const normalizedEventUrl = normalizePublicUrl(eventUrl);
    const html = await this.fetchText(normalizedEventUrl);
    const $ = cheerio.load(html);
    const bodyText = cleanText($("body").text());
    const title = cleanText(
      $("meta[property='og:title']").attr("content") ||
        $("meta[name='twitter:title']").attr("content") ||
        $("title").text() ||
        $("h1").first().text(),
    );
    const description = cleanText(
      $("meta[property='og:description']").attr("content") ||
        $("meta[name='description']").attr("content") ||
        "",
    );
    const jsonLdEvent = parseJsonLdEvent($);
    const dateRange =
      dateRangeFromJsonLd(jsonLdEvent) ??
      parseDateRange(`${title} ${description} ${bodyText.slice(0, 1000)}`);
    if (!dateRange)
      throw new Error(
        `Could not parse public event date range from ${normalizedEventUrl}`,
      );

    const name = cleanText(
      jsonLdEvent.name ?? stripTitleSuffix(title, dateRange.raw) ?? title,
    );
    if (!name)
      throw new Error(
        `Could not parse public event name from ${normalizedEventUrl}`,
      );
    const sourceText = `${source.name} ${source.organizerName ?? ""} ${source.sanctioningTags?.join(" ") ?? ""} ${title} ${description} ${bodyText.slice(0, 1200)}`;
    if (!/\bbasketball\b/i.test(sourceText))
      throw new Error(
        `Public HTML event does not appear to be basketball: ${normalizedEventUrl}`,
      );

    const location =
      cleanText(jsonLdLocation(jsonLdEvent.location)) ||
      parseLocationFromTitle(title, dateRange.raw) ||
      parseLocationFromDescription(description) ||
      parseLocationFromDescription(bodyText) ||
      "";
    const { city, state } = splitCityState(location);
    const externalId = externalIdFromUrl(normalizedEventUrl);
    const syntheticEventId = publicSyntheticEventId(
      this.providerName,
      externalId,
    );
    const status = bodyText.match(/\bcancelled\b/i)
      ? "cancelled"
      : deriveTournamentStatus({
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          status: "upcoming",
        });

    return {
      id: `event-${syntheticEventId}`,
      exposureEventId: syntheticEventId,
      externalProvider: this.providerName,
      externalId,
      slug: slugFromPublicUrlOrName(normalizedEventUrl, name),
      sourceUrl: normalizedEventUrl,
      name,
      organizer: source.organizerName ?? source.name,
      sport: "basketball",
      sanctioningTags: dedupeStrings([
        ...(source.sanctioningTags ?? []),
        ...parseSanctioningTags(bodyText),
        "Public Source",
      ]),
      gender: parseGender(bodyText),
      ageOrGradeDivisions: parseAgeOrGradeDivisions(bodyText),
      venueName: null,
      city,
      state,
      region: tournamentRegionFromLocation(city, state, location, source),
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      location:
        location || [city, state].filter(Boolean).join(", ") || "Location TBD",
      officialUrl: normalizedEventUrl,
      timezone: source.timezone ?? DEFAULT_TOURNAMENT_TIMEZONE,
      registeredTeamCount: 0,
      hasPublicTeamList: false,
      lastCheckedAt: null,
      lastSyncedAt: null,
      lastTeamChangeAt: null,
      status,
      dropdownGroup: "upcoming",
    };
  }

  private async fetchText(url: string): Promise<string> {
    await assertRobotsAllowed(url, this.fetchImpl);
    const response = await this.fetchImpl(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": publicUserAgent(),
      },
    });
    if (!response.ok)
      throw new Error(
        `Public HTML page request failed with ${response.status}`,
      );
    return response.text();
  }
}

export class AauEventFinderTournamentProvider implements TournamentProvider {
  readonly providerName = "aau_event_finder" as const;
  readonly supportsPublicTeamLists = true;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly publicClient: PublicExposurePageClient;

  constructor(options: { baseUrl?: string; fetchImpl?: typeof fetch } = {}) {
    this.baseUrl =
      options.baseUrl ??
      process.env.EXPOSURE_PUBLIC_BASE_URL ??
      "https://basketball.exposureevents.com";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.publicClient = new PublicExposurePageClient({
      baseUrl: this.baseUrl,
      fetchImpl: this.fetchImpl,
    });
  }

  async discoverEvents(
    source: MajorTournamentSource,
    window: TournamentDiscoveryWindow,
  ): Promise<DiscoveredTournamentEvent[]> {
    const sourceUrl = new URL(
      source.url ?? "/youth-basketball-events",
      this.baseUrl,
    ).toString();
    const initialResponse = await this.fetchDirectoryPage(sourceUrl);
    const token = parseExposureToken(initialResponse.html);
    if (!token) return [];

    const maxEvents = Math.max(1, source.maxEvents ?? 2600);
    const directoryEventType = source.directoryEventType ?? "";
    const events: DiscoveredTournamentEvent[] = [];
    let page = 1;

    while (events.length < maxEvents) {
      const body = new URLSearchParams({
        Page: String(page),
        sportType: "1",
        StartDateString: dateKeyToExposureDate(window.startDate),
      });
      if (!source.ignoreDiscoveryWindowEnd)
        body.set("EndDateString", dateKeyToExposureDate(window.endDate));
      if (directoryEventType) body.set("EventType", directoryEventType);

      const response = await this.fetchImpl(sourceUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Exposure-Token": token,
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent": publicUserAgent(),
          ...(initialResponse.cookie ? { Cookie: initialResponse.cookie } : {}),
        },
        body: body.toString(),
      });
      if (!response.ok)
        throw new Error(
          `Exposure basketball directory request failed with ${response.status}`,
        );

      const payload = (await response.json()) as ExposureDirectoryPayload;
      const results = payload.Results ?? [];
      for (const item of results) {
        const event = directoryItemToTournamentEvent(
          item,
          source,
          this.baseUrl,
        );
        if (!event) continue;
        if (
          (!source.ignoreDiscoveryWindowEnd &&
            event.startDate > window.endDate) ||
          event.endDate < window.startDate
        )
          continue;
        events.push(event);
        if (events.length >= maxEvents) break;
      }
      if (!hasMoreExposureDirectoryPages(payload, page, results.length)) break;
      page += 1;
      await sleep(
        Number(process.env.TOURNAMENT_DISCOVERY_REQUEST_DELAY_MS ?? 125),
      );
    }

    return dedupeDiscoveredEvents(events);
  }

  async fetchRegisteredTeams(
    event: DiscoveredTournamentEvent,
  ): Promise<PublicExposureTeamResult> {
    return this.publicClient.fetchTeams(
      event.exposureEventId,
      event.slug,
      event.timezone,
    );
  }

  private async fetchDirectoryPage(
    sourceUrl: string,
  ): Promise<{ html: string; cookie: string }> {
    await assertRobotsAllowed(sourceUrl, this.fetchImpl);
    const response = await this.fetchImpl(sourceUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": publicUserAgent(),
      },
    });
    if (!response.ok)
      throw new Error(
        `Exposure basketball directory page request failed with ${response.status}`,
      );
    return {
      html: await response.text(),
      cookie: cookieHeaderFromResponse(response),
    };
  }
}

function directoryItemToTournamentEvent(
  item: Record<string, unknown>,
  source: MajorTournamentSource,
  baseUrl: string,
): DiscoveredTournamentEvent | null {
  const link = stringValue(item.Link ?? item.Url ?? item.URL);
  const eventUrl = link ? normalizeExposureEventUrl(link, baseUrl) : null;
  if (!eventUrl) return null;
  const parsed = parseExposureEventUrl(eventUrl);
  if (!parsed) return null;

  const startDate = dateKeyFromUnknown(item.StartDate);
  if (!startDate) return null;
  const endDate = dateKeyFromUnknown(item.EndDate) ?? startDate;
  const name =
    stringValue(item.Name) ??
    stringValue(item.Title) ??
    `Exposure Event ${parsed.eventId}`;
  const city = stringValue(item.City);
  const rawState =
    stringValue(item.StateRegionAbbr) ??
    stringValue(item.StateRegion) ??
    stringValue(item.State);
  const cityState = stringValue(item.CityState) ?? "";
  const split = splitCityState(cityState);
  const resolvedCity = city ?? split.city;
  const resolvedState = rawState ?? split.state;
  const location =
    cityState ||
    [resolvedCity, resolvedState].filter(Boolean).join(", ") ||
    "Location TBD";
  const venueName = stringValue(item.Location);
  const organizer =
    stringValue(item.OrganizationName) ?? source.organizerName ?? source.name;
  const eventType = stringValue(item.Type);
  const gender = parseGender(
    `${stringValue(item.YouthAgeGradesBoth) ?? ""} ${eventType ?? ""}`,
  );
  const registeredTeamCount =
    numberValue(
      item.TeamCount ??
        item.TeamsCount ??
        item.RegisteredTeamCount ??
        item.RegisteredTeams,
    ) ?? 0;

  return {
    id: `event-${parsed.eventId}`,
    exposureEventId: parsed.eventId,
    externalProvider: "exposure_events",
    externalId: String(parsed.eventId),
    slug: parsed.slug,
    sourceUrl: eventUrl,
    name,
    organizer,
    sport: "basketball",
    sanctioningTags: dedupeStrings([
      ...(source.sanctioningTags ?? []),
      ...(eventType ? [eventType] : []),
      "Exposure Events",
    ]),
    gender,
    ageOrGradeDivisions: parseAgeOrGradeDivisions(
      `${stringValue(item.YouthAgeGradesBoth) ?? ""} ${name}`,
    ),
    venueName,
    city: resolvedCity,
    state: resolvedState,
    region: tournamentRegionFromLocation(
      resolvedCity,
      resolvedState,
      location,
      source,
    ),
    startDate,
    endDate,
    location,
    officialUrl: eventUrl,
    timezone: source.timezone ?? DEFAULT_TOURNAMENT_TIMEZONE,
    registeredTeamCount,
    hasPublicTeamList: false,
    lastCheckedAt: null,
    lastSyncedAt: null,
    lastTeamChangeAt: null,
    status: deriveTournamentStatus({
      startDate,
      endDate,
      status: "upcoming",
    }),
    dropdownGroup: "upcoming",
  };
}

function cookieHeaderFromResponse(response: Response): string {
  const headersWithCookies = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const cookies =
    headersWithCookies.getSetCookie?.() ??
    (response.headers.get("set-cookie")
      ? [response.headers.get("set-cookie") ?? ""]
      : []);
  return cookies
    .map((cookie) => cookie.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

function dedupeDiscoveredEvents(
  events: DiscoveredTournamentEvent[],
): DiscoveredTournamentEvent[] {
  const seen = new Set<string>();
  const result: DiscoveredTournamentEvent[] = [];
  for (const event of events) {
    const keys = tournamentDiscoveryDedupeKeys(event);
    if (keys.some((key) => seen.has(key))) continue;
    for (const key of keys) seen.add(key);
    result.push(event);
  }
  return result;
}

function tournamentDiscoveryDedupeKeys(
  event: DiscoveredTournamentEvent,
): string[] {
  return [
    tournamentDedupeKey(event),
    [
      "fallback",
      event.name,
      event.startDate,
      event.city,
      event.state,
      event.organizer,
    ]
      .map((part) => normalizeName(part ?? ""))
      .join("|"),
  ];
}

function parseExposureEventLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const urls = new Set<string>();
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    const url = normalizeExposureEventUrl(href, baseUrl);
    if (url) urls.add(url);
  });
  return Array.from(urls);
}

function normalizeExposureEventUrl(
  value: string,
  baseUrl: string,
): string | null {
  try {
    const url = new URL(value, baseUrl);
    const parsed = parseExposureEventUrl(url.toString());
    if (!parsed) return null;
    return new URL(`/${parsed.eventId}/${parsed.slug}`, url.origin).toString();
  } catch {
    return null;
  }
}

function parseExposureEventUrl(
  value: string,
): { eventId: number; slug: string } | null {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const eventId = Number(parts[0]);
    if (!Number.isInteger(eventId) || eventId <= 0) return null;
    const slug = parts[1];
    if (
      !slug ||
      ["teams", "schedule", "bracket", "organizations"].includes(slug)
    )
      return null;
    return { eventId, slug };
  } catch {
    return null;
  }
}

function parsePublicHtmlEventLinks(
  html: string,
  sourceUrl: string,
  patterns: string[],
): string[] {
  const regexes = patterns.map((pattern) => new RegExp(pattern, "i"));
  const $ = cheerio.load(html);
  const urls = new Set<string>();
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    const absoluteUrl = normalizePublicUrl(href, sourceUrl);
    const text = cleanText($(element).text());
    if (
      regexes.some(
        (regex) =>
          regex.test(href) || regex.test(absoluteUrl) || regex.test(text),
      )
    )
      urls.add(absoluteUrl);
  });
  return Array.from(urls);
}

function publicTeamListUrls(
  eventUrl: string,
  eventHtml: string,
  source?: MajorTournamentSource,
): string[] {
  const urls = new Set<string>();
  const event = new URL(eventUrl);
  const slug = slugFromPublicUrlOrName(
    eventUrl,
    event.pathname.split("/").filter(Boolean).at(-1) ?? "event",
  );
  for (const template of source?.teamListUrlTemplates ?? []) {
    urls.add(
      normalizePublicUrl(
        template
          .replaceAll("{eventUrl}", eventUrl)
          .replaceAll("{origin}", event.origin)
          .replaceAll("{pathname}", event.pathname)
          .replaceAll("{slug}", slug),
        eventUrl,
      ),
    );
  }

  const patterns = (
    source?.teamListLinkPatterns?.length
      ? source.teamListLinkPatterns
      : [
          "teams?",
          "registered\\s+teams?",
          "participating\\s+teams?",
          "team\\s+list",
          "clubs?",
        ]
  ).map((pattern) => new RegExp(pattern, "i"));
  const $ = cheerio.load(eventHtml);
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    const text = cleanText($(element).text());
    const absoluteUrl = normalizePublicUrl(href, eventUrl);
    if (
      patterns.some(
        (regex) =>
          regex.test(href) || regex.test(absoluteUrl) || regex.test(text),
      )
    )
      urls.add(absoluteUrl);
  });

  if ((source?.teamSelectors?.length ?? 0) > 0) urls.add(eventUrl);
  return Array.from(urls);
}

function looksLikeTeamListPage(
  url: string,
  html: string,
  source?: MajorTournamentSource,
): boolean {
  if ((source?.teamSelectors?.length ?? 0) > 0) return true;
  const $ = cheerio.load(html);
  const titleText = cleanText(
    `${$("title").text()} ${$("h1,h2,h3")
      .map((_, element) => $(element).text())
      .get()
      .join(" ")}`,
  );
  return /\b(teams?|registered teams?|participating teams?|team list|clubs?)\b/i.test(
    `${url} ${titleText}`,
  );
}

function parsePublicHtmlTeams(
  html: string,
  event: DiscoveredTournamentEvent,
  sourceUrl: string,
  source?: MajorTournamentSource,
): PublicExposureTeamResult {
  const $ = cheerio.load(html);
  const divisions = new Map<
    string,
    PublicExposureTeamResult["divisions"][number]
  >();
  const teams = new Map<string, PublicExposureTeamResult["teams"][number]>();
  const selectors = source?.teamSelectors?.length
    ? source.teamSelectors
    : ["[data-team-name]"];

  for (const selector of selectors) {
    $(selector).each((_, element) => {
      const node = $(element);
      const teamName = cleanTeamName(
        node.attr("data-team-name") || node.text(),
      );
      if (!teamName) return;
      const divisionName = cleanText(
        node.attr("data-division") ||
          closestDivisionName(node) ||
          "Unknown Division",
      );
      addPublicHtmlTeam({
        event,
        sourceUrl,
        teamName,
        divisionName,
        divisions,
        teams,
      });
    });
  }

  parseTeamTables($, event, sourceUrl, divisions, teams);
  parseTeamTextSections($, event, sourceUrl, divisions, teams);

  return {
    divisions: Array.from(divisions.values()),
    teams: Array.from(teams.values()),
  };
}

function addPublicHtmlTeam({
  event,
  sourceUrl,
  teamName,
  divisionName,
  divisions,
  teams,
}: {
  event: DiscoveredTournamentEvent;
  sourceUrl: string;
  teamName: string;
  divisionName: string;
  divisions: Map<string, PublicExposureTeamResult["divisions"][number]>;
  teams: Map<string, PublicExposureTeamResult["teams"][number]>;
}) {
  const divisionKey = normalizeName(divisionName) || "unknown";
  const divisionId = `public-division-${event.exposureEventId}-${divisionKey.replace(/\s+/g, "-")}`;
  const meta = extractDivisionMetaSafe(divisionName);
  divisions.set(divisionId, {
    id: divisionId,
    eventId: event.id,
    exposureDivisionId: divisionKey,
    name: divisionName,
    gender: meta.gender,
    gradeLevel: meta.gradeLevel,
    level: meta.level,
    rawJson: { source: "public_html", sourceUrl },
  });

  const teamKey = stableKey(
    `${event.externalProvider}|${event.externalId}|${divisionName}|${teamName}`,
  );
  const teamId = `public-team-${event.exposureEventId}-${teamKey}`;
  teams.set(teamId, {
    id: teamId,
    eventId: event.id,
    divisionId,
    exposureTeamId: teamKey,
    name: teamName,
    normalizedName: normalizeName(teamName),
    clubName: null,
    normalizedClubName: null,
    coachName: null,
    sourceUrl,
    divisionName,
    gender: meta.gender,
    gradeLevel: meta.gradeLevel,
    level: meta.level,
    rawJson: { source: "public_html", sourceUrl, divisionName },
    lastSeenAt: new Date().toISOString(),
  });
}

function parseTeamTables(
  $: cheerio.CheerioAPI,
  event: DiscoveredTournamentEvent,
  sourceUrl: string,
  divisions: Map<string, PublicExposureTeamResult["divisions"][number]>,
  teams: Map<string, PublicExposureTeamResult["teams"][number]>,
) {
  $("table").each((_, table) => {
    const headers = $(table)
      .find("th")
      .map((__, th) => cleanText($(th).text()).toLowerCase())
      .get();
    const teamColumn = headers.findIndex(
      (header) => header === "team" || header === "team name",
    );
    if (teamColumn < 0) return;
    const divisionName =
      cleanText($(table).prevAll("h1,h2,h3,h4").first().text()) ||
      "Unknown Division";
    $(table)
      .find("tr")
      .each((__, row) => {
        const cells = $(row).find("td");
        const cell = cells.eq(teamColumn);
        const teamName = cleanTeamName(cell.text());
        if (!teamName) return;
        addPublicHtmlTeam({
          event,
          sourceUrl,
          teamName,
          divisionName,
          divisions,
          teams,
        });
      });
  });
}

function parseTeamTextSections(
  $: cheerio.CheerioAPI,
  event: DiscoveredTournamentEvent,
  sourceUrl: string,
  divisions: Map<string, PublicExposureTeamResult["divisions"][number]>,
  teams: Map<string, PublicExposureTeamResult["teams"][number]>,
) {
  const lines = $("body").text().split(/\r?\n/).map(cleanText).filter(Boolean);
  let inTeams = false;
  let divisionName = "Unknown Division";
  for (const line of lines) {
    if (
      /^(teams?|registered teams?|participating teams?|team list)$/i.test(line)
    ) {
      inTeams = true;
      continue;
    }
    if (!inTeams) continue;
    if (
      /^(schedule|bracket|champions?|contact|registration|location|documents?|rules?|standings?)$/i.test(
        line,
      )
    )
      break;
    if (isLikelyDivisionName(line)) {
      divisionName = line;
      continue;
    }
    const teamName = cleanTeamName(line);
    if (!teamName) continue;
    addPublicHtmlTeam({
      event,
      sourceUrl,
      teamName,
      divisionName,
      divisions,
      teams,
    });
  }
}

function closestDivisionName(node: cheerio.Cheerio<AnyNode>): string | null {
  return (
    cleanText(
      node.closest("[data-division]").attr("data-division") ||
        node.prevAll("h1,h2,h3,h4").first().text(),
    ) || null
  );
}

function parseExposureToken(html: string): string | null {
  return (
    html.match(/tokenValue:\s*'([^']+)'/)?.[1] ??
    html.match(/tokenValue:\s*"([^"]+)"/)?.[1] ??
    null
  );
}

function parseDateRange(
  text: string,
): { startDate: string; endDate: string; raw: string } | null {
  const monthPattern =
    "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
  const match = new RegExp(
    `${monthPattern}\\s+(\\d{1,2})(?:\\s*-\\s*(?:${monthPattern}\\s+)?(\\d{1,2}))?,\\s*(\\d{4})`,
    "i",
  ).exec(text);
  if (!match) return null;
  const startMonth = monthNumber(match[1] ?? "");
  const startDay = Number(match[2]);
  const endMonth = monthNumber(match[3] ?? "") || startMonth;
  const endDay = Number(match[4] ?? startDay);
  const year = Number(match[5]);
  if (!startMonth || !startDay || !endMonth || !endDay || !year) return null;
  return {
    startDate: dateKey(year, startMonth, startDay),
    endDate: dateKey(year, endMonth, endDay),
    raw: match[0],
  };
}

function stripTitleSuffix(title: string, dateText: string): string | null {
  const index = title.indexOf(dateText);
  if (index <= 0) return null;
  return cleanText(title.slice(0, index).replace(/\s+-\s*$/, ""));
}

function parseLocationFromTitle(
  title: string,
  dateText: string,
): string | null {
  const index = title.indexOf(dateText);
  if (index < 0) return null;
  return cleanText(
    title.slice(index + dateText.length).replace(/^\s+-\s*/, ""),
  );
}

function parseLocationFromDescription(description: string): string | null {
  return cleanText(
    description.match(/\bat\s+-?\s*([A-Za-z .'-]+,\s*[A-Za-z .'-]+)/)?.[1] ??
      "",
  );
}

function splitCityState(location: string): {
  city: string | null;
  state: string | null;
} {
  const [city, ...rest] = location.split(",").map((part) => cleanText(part));
  return { city: city || null, state: cleanText(rest.join(", ")) || null };
}

function tournamentRegionFromLocation(
  city: string | null,
  state: string | null,
  location: string,
  source: MajorTournamentSource,
): string | null {
  const stateCode = normalizeStateCode(`${state ?? ""} ${location}`);
  if (stateCode === "CA") {
    return californiaTournamentRegionFromPlace(`${city ?? ""} ${location}`);
  }
  return stateCode || source.region || state || null;
}

function normalizeStateCode(value: string): string | null {
  const source = value.toLowerCase();
  if (/\bca\b|california/.test(source)) return "CA";
  if (/\baz\b|arizona/.test(source)) return "AZ";
  if (/\bco\b|colorado/.test(source)) return "CO";
  if (/\bfl\b|florida/.test(source)) return "FL";
  if (/\bnv\b|nevada/.test(source)) return "NV";
  if (/\bor\b|oregon/.test(source)) return "OR";
  if (/\btx\b|texas/.test(source)) return "TX";
  if (/\bwa\b|washington/.test(source)) return "WA";
  const compact = cleanText(value).toUpperCase();
  return compact.length === 2 ? compact : null;
}

function parseVenueName($: cheerio.CheerioAPI): string | null {
  const locationHeading = $("h2, h3")
    .filter(
      (_, element) => cleanText($(element).text()).toLowerCase() === "location",
    )
    .first();
  const firstText = cleanText(
    locationHeading
      .nextAll()
      .filter((_, element) => cleanText($(element).text()).length > 0)
      .first()
      .text(),
  );
  return firstText || null;
}

function parseGender(text: string): string | null {
  if (/\bBoys\s*&\s*Girls\b/i.test(text)) return "Boys & Girls";
  if (/\bBoys\b/i.test(text) && /\bGirls\b/i.test(text)) return "Boys & Girls";
  if (/\bGirls\b/i.test(text)) return "Girls";
  if (/\bBoys\b/i.test(text)) return "Boys";
  return null;
}

function parseSanctioningTags(text: string): string[] {
  const tags: string[] = [];
  if (/\bAAU Licensed\b/i.test(text)) tags.push("AAU");
  if (/\bNCAA Certified\b/i.test(text)) tags.push("NCAA Certified");
  if (/\bExposure Certified\b/i.test(text)) tags.push("Exposure Certified");
  if (/\bJam On It\b/i.test(text)) tags.push("Jam On It");
  return tags;
}

function parseAgeOrGradeDivisions(text: string): string[] {
  const values = new Set<string>();
  for (const match of text.matchAll(
    /\b(?:Boys|Girls)\s+(?:\d{1,2}(?:st|nd|rd|th)|Varsity)\b/gi,
  ))
    values.add(cleanText(match[0]));
  return Array.from(values).slice(0, 80);
}

interface JsonLdEvent {
  "@type"?: string | string[];
  name?: string;
  startDate?: string;
  endDate?: string;
  location?: unknown;
}

function parseJsonLdEvent($: cheerio.CheerioAPI): JsonLdEvent {
  for (const script of $("script[type='application/ld+json']").toArray()) {
    const parsed = parseJson($(script).contents().text());
    for (const item of flattenJsonLd(parsed)) {
      const typeValue = Array.isArray(item["@type"])
        ? item["@type"].join(" ")
        : String(item["@type"] ?? "");
      if (/\b(Event|SportsEvent)\b/i.test(typeValue)) return item;
    }
  }
  return {};
}

function flattenJsonLd(value: unknown): JsonLdEvent[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!isRecord(value)) return [];
  const graph = value["@graph"];
  if (Array.isArray(graph)) return graph.flatMap(flattenJsonLd);
  return [value as JsonLdEvent];
}

function dateRangeFromJsonLd(
  event: JsonLdEvent,
): { startDate: string; endDate: string; raw: string } | null {
  const startDate = dateKeyFromUnknown(event.startDate);
  if (!startDate) return null;
  const endDate = dateKeyFromUnknown(event.endDate) ?? startDate;
  return {
    startDate,
    endDate,
    raw:
      [event.startDate, event.endDate].filter(Boolean).join(" - ") || startDate,
  };
}

function dateKeyFromUnknown(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function jsonLdLocation(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return jsonLdLocation(value[0]);
  if (!isRecord(value)) return "";
  const address = value.address;
  if (typeof address === "string") return address;
  if (isRecord(address)) {
    return [address.addressLocality, address.addressRegion]
      .filter(
        (part): part is string =>
          typeof part === "string" && Boolean(part.trim()),
      )
      .join(", ");
  }
  return [value.name, value.addressLocality, value.addressRegion]
    .filter(
      (part): part is string =>
        typeof part === "string" && Boolean(part.trim()),
    )
    .join(", ");
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function extractDivisionMetaSafe(divisionName: string) {
  return extractDivisionMeta(divisionName);
}

function cleanTeamName(value: string): string | null {
  const text = cleanText(value)
    .replace(/\s+\(\d+\s*-\s*\d+(?:\s*-\s*\d+)?\)$/i, "")
    .replace(/\s+Champion$/i, "")
    .trim();
  if (text.length < 2 || text.length > 90) return null;
  if (
    /^(team|teams|schedule|standings|bracket|pool|division|select|loading|register|notifications?|share|copy|score|w|l|pd|ps|pa)$/i.test(
      text,
    )
  )
    return null;
  if (/^\d+$/.test(text)) return null;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(text)) return null;
  return text;
}

function isLikelyDivisionName(value: string): boolean {
  return (
    /\b(boys?|girls?|grade|u|varsity|division|gold|silver|bronze|platinum|pool)\b/i.test(
      value,
    ) && value.length <= 80
  );
}

function normalizePublicUrl(value: string, baseUrl?: string): string {
  const url = new URL(value, baseUrl);
  url.hash = "";
  return url.toString();
}

function externalIdFromUrl(value: string): string {
  const url = new URL(value);
  return `${url.hostname}${url.pathname}${url.search}`.toLowerCase();
}

function slugFromPublicUrlOrName(value: string, name: string): string {
  const pathSlug = new URL(value).pathname.split("/").filter(Boolean).at(-1);
  return slugify(pathSlug || name || "public-event");
}

function slugify(value: string): string {
  return normalizeName(value).replace(/\s+/g, "-") || "public-event";
}

function publicSyntheticEventId(provider: string, externalId: string): number {
  return (
    1_000_000_000 + (stableHash(`${provider}|${externalId}`) % 900_000_000)
  );
}

function stableKey(value: string): string {
  return stableHash(value).toString(36);
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthNumber(month: string): number {
  const key = month.slice(0, 3).toLowerCase();
  return (
    [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ].indexOf(key) + 1
  );
}

function dateKeyToExposureDate(dateKeyValue: string): string {
  const [year, month, day] = dateKeyValue.split("-").map(Number);
  return `${month}/${day}/${year}`;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function hasMoreExposureDirectoryPages(
  payload: ExposureDirectoryPayload,
  requestedPage: number,
  resultsLength: number,
): boolean {
  if (resultsLength === 0) return false;
  const page = numberValue(payload.Page) ?? requestedPage;
  const totalPages = numberValue(payload.TotalPages);
  if (totalPages) return page < totalPages;
  const pageSize = numberValue(payload.PageSize);
  const total = numberValue(payload.Total);
  if (pageSize && total) return page * pageSize < total;
  if (pageSize) return resultsLength >= pageSize;
  return false;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map(cleanText).filter(Boolean)) {
    const key = normalizeName(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

const robotsCache = new Map<string, Promise<RobotsRules>>();

interface RobotsRules {
  disallow: string[];
  allow: string[];
}

interface RobotsGroup extends RobotsRules {
  agents: string[];
}

async function assertRobotsAllowed(url: string, fetchImpl: typeof fetch) {
  if (process.env.TOURNAMENT_DISCOVERY_RESPECT_ROBOTS === "false") return;
  const parsed = new URL(url);
  const rules = await robotsRulesForOrigin(parsed.origin, fetchImpl);
  if (!isRobotsPathAllowed(parsed.pathname, rules))
    throw new Error(
      `robots.txt disallows public discovery for ${parsed.origin}${parsed.pathname}`,
    );
}

function robotsRulesForOrigin(
  origin: string,
  fetchImpl: typeof fetch,
): Promise<RobotsRules> {
  const existing = robotsCache.get(origin);
  if (existing) return existing;
  const pending = fetchImpl(new URL("/robots.txt", origin), {
    headers: { Accept: "text/plain", "User-Agent": publicUserAgent() },
  })
    .then(async (response) => {
      if (!response.ok) return { allow: [], disallow: [] };
      return parseRobotsTxt(await response.text());
    })
    .catch(() => ({ allow: [], disallow: [] }));
  robotsCache.set(origin, pending);
  return pending;
}

function parseRobotsTxt(text: string): RobotsRules {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let currentHasRules = false;

  const pushCurrent = () => {
    if (current && current.agents.length > 0) groups.push(current);
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const [rawKey, ...rawValue] = line.split(":");
    const key = rawKey?.trim().toLowerCase();
    const value = rawValue.join(":").trim();
    if (key === "user-agent") {
      if (!current || currentHasRules) {
        pushCurrent();
        current = { agents: [], allow: [], disallow: [] };
        currentHasRules = false;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (!current) continue;
    if (key === "allow" && value) {
      current.allow.push(value);
      currentHasRules = true;
    }
    if (key === "disallow" && value) {
      current.disallow.push(value);
      currentHasRules = true;
    }
  }
  pushCurrent();

  const matchingGroups = groups.filter((group) =>
    group.agents.some(robotsAgentMatches),
  );
  const nonWildcardGroups = matchingGroups.filter(
    (group) => !group.agents.includes("*"),
  );
  const selectedGroups =
    nonWildcardGroups.length > 0 ? nonWildcardGroups : matchingGroups;

  return selectedGroups.reduce<RobotsRules>(
    (rules, group) => ({
      allow: [...rules.allow, ...group.allow],
      disallow: [...rules.disallow, ...group.disallow],
    }),
    { allow: [], disallow: [] },
  );
}

function isRobotsPathAllowed(pathname: string, rules: RobotsRules): boolean {
  const matchingDisallows = rules.disallow.filter((rule) =>
    robotsRuleMatches(pathname, rule),
  );
  if (matchingDisallows.length === 0) return true;
  const matchingAllows = rules.allow.filter((rule) =>
    robotsRuleMatches(pathname, rule),
  );
  const longestAllow = Math.max(
    0,
    ...matchingAllows.map((rule) => rule.length),
  );
  return matchingDisallows.every((rule) => longestAllow > rule.length);
}

function robotsRuleMatches(pathname: string, rule: string): boolean {
  if (!rule) return false;
  const anchorsAtEnd = rule.endsWith("$");
  const ruleBody = anchorsAtEnd ? rule.slice(0, -1) : rule;
  const pattern = ruleBody.split("*").map(escapeRegex).join(".*");
  return new RegExp(`^${pattern}${anchorsAtEnd ? "$" : ""}`).test(pathname);
}

function robotsAgentMatches(agent: string): boolean {
  return agent === "*" || publicUserAgent().toLowerCase().includes(agent);
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function publicUserAgent(): string {
  return "CourtWatchAAU/0.1 (+independent companion tracker; public cache-backed tournament discovery)";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown provider error";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
