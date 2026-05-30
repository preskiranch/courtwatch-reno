import { z } from "zod";
import type { MajorTournamentSource, TournamentEvent } from "@courtwatch/core";
import {
  DEFAULT_MAJOR_TOURNAMENT_SOURCES,
  DEFAULT_TOURNAMENT_TIMEZONE,
} from "@courtwatch/core";

const ConfigSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().optional(),
  WEB_BASE_URL: z.string().default("http://localhost:3000"),
  WEB_ALLOWED_ORIGINS: z.string().optional(),
  API_BASE_URL: z.string().default("http://localhost:4000"),
  EXPOSURE_API_KEY: z.string().optional(),
  EXPOSURE_SECRET_KEY: z.string().optional(),
  EXPOSURE_EVENT_ID: z.coerce.number().default(255539),
  EXPOSURE_EVENT_SLUG: z.string().default("2026-reno-memorial-day-tournament"),
  EXPOSURE_EVENTS: z.string().optional(),
  DEFAULT_EXPOSURE_EVENT_ID: z.coerce.number().optional(),
  MAJOR_TOURNAMENT_SOURCES: z.string().optional(),
  TOURNAMENT_DISCOVERY_ENABLED: z.coerce.boolean().default(true),
  TOURNAMENT_DISCOVERY_INTERVAL_HOURS: z.coerce.number().default(24),
  TOURNAMENT_DISCOVERY_WINDOW_DAYS: z.coerce.number().default(183),
  TOURNAMENT_DROPDOWN_CACHE_HOURS: z.coerce.number().default(720),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  PUSH_CONTACT_EMAIL: z.string().default("mailto:admin@example.com"),
  JWT_SECRET: z.string().optional(),
  ADMIN_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  PASSWORD_RESET_FROM_EMAIL: z.string().optional(),
  PASSWORD_RESET_EXPOSE_TOKEN: z.coerce.boolean().default(false),
});

export const config = ConfigSchema.parse(process.env);

export function isDatabaseConfigured(): boolean {
  return Boolean(
    config.DATABASE_URL?.startsWith("postgresql://") ||
    config.DATABASE_URL?.startsWith("postgres://"),
  );
}

export function isExposureConfigured(): boolean {
  return Boolean(config.EXPOSURE_API_KEY && config.EXPOSURE_SECRET_KEY);
}

export interface TournamentSource extends TournamentEvent {}

const fallbackTournament: TournamentSource = {
  id: "event-reno-2026",
  exposureEventId: 255539,
  externalProvider: "exposure_events",
  externalId: "255539",
  slug: "2026-reno-memorial-day-tournament",
  sourceUrl:
    "https://basketball.exposureevents.com/255539/2026-reno-memorial-day-tournament",
  name: "2026 Reno Memorial Day Tournament",
  organizer: "Jam On It",
  sport: "basketball",
  sanctioningTags: ["Jam On It", "Exposure Events"],
  gender: "Boys & Girls",
  ageOrGradeDivisions: [],
  venueName: null,
  city: "Reno",
  state: "Nevada",
  region: "Nevada",
  startDate: "2026-05-23",
  endDate: "2026-05-25",
  location: "Reno, Nevada",
  officialUrl:
    "https://basketball.exposureevents.com/255539/2026-reno-memorial-day-tournament",
  timezone: DEFAULT_TOURNAMENT_TIMEZONE,
  registeredTeamCount: 0,
  hasPublicTeamList: false,
  lastCheckedAt: null,
  lastSyncedAt: null,
  lastTeamChangeAt: null,
  status: "upcoming",
  dropdownGroup: "tracked",
};

const gsgSpringFinaleTournament: TournamentSource = {
  id: "event-bam-gsg-spring-finale-2026",
  exposureEventId: 264312,
  externalProvider: "exposure_events",
  externalId: "264312",
  slug: "bam-x-gsg-spring-finale",
  sourceUrl:
    "https://basketball.exposureevents.com/264312/bam-x-gsg-spring-finale",
  name: "BAM x GSG - Spring Finale",
  organizer: "GSG Hoops",
  sport: "basketball",
  sanctioningTags: [
    "GSG Hoops",
    "Golden State Games",
    "BAM",
    "BAMTOURNAMENTS",
    "BAM x GSG",
    "Exposure Events",
  ],
  gender: "Boys & Girls",
  ageOrGradeDivisions: [],
  venueName: null,
  city: "San Ramon/Danville",
  state: "CA",
  region: "California",
  startDate: "2026-05-30",
  endDate: "2026-05-30",
  location: "San Ramon/Danville, CA",
  officialUrl:
    "https://basketball.exposureevents.com/264312/bam-x-gsg-spring-finale",
  timezone: DEFAULT_TOURNAMENT_TIMEZONE,
  registeredTeamCount: 0,
  hasPublicTeamList: false,
  lastCheckedAt: null,
  lastSyncedAt: null,
  lastTeamChangeAt: null,
  status: "upcoming",
  dropdownGroup: "tracked",
};

const defaultTrackedTournaments = [
  fallbackTournament,
  gsgSpringFinaleTournament,
];

const TournamentSourceSchema = z
  .object({
    id: z.string().optional(),
    exposureEventId: z.coerce.number(),
    externalProvider: z.string().trim().default("exposure_events"),
    externalId: z.string().trim().optional(),
    slug: z.string().trim().min(1),
    sourceUrl: z.string().trim().url().optional(),
    name: z.string().trim().min(1),
    organizer: z.string().trim().default("Youth Basketball Tournament"),
    sport: z.string().trim().default("basketball"),
    sanctioningTags: z.array(z.string().trim()).default(["Exposure Events"]),
    gender: z.string().trim().nullable().default(null),
    ageOrGradeDivisions: z.array(z.string().trim()).default([]),
    venueName: z.string().trim().nullable().default(null),
    city: z.string().trim().nullable().optional(),
    state: z.string().trim().nullable().optional(),
    region: z.string().trim().nullable().optional(),
    startDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/),
    location: z.string().trim().default("Location TBD"),
    officialUrl: z.string().trim().url().optional(),
    timezone: z.string().trim().default(DEFAULT_TOURNAMENT_TIMEZONE),
    registeredTeamCount: z.coerce.number().default(0),
    hasPublicTeamList: z.coerce.boolean().default(false),
    lastCheckedAt: z.string().nullable().default(null),
    lastSyncedAt: z.string().nullable().default(null),
    lastTeamChangeAt: z.string().nullable().default(null),
    status: z
      .enum(["upcoming", "active", "completed", "unavailable", "cancelled"])
      .default("upcoming"),
  })
  .transform((value): TournamentSource => {
    const id = value.id ?? `event-${value.exposureEventId}`;
    const cityState = splitCityState(value.location);
    return {
      id,
      exposureEventId: value.exposureEventId,
      externalProvider: value.externalProvider,
      externalId: value.externalId ?? String(value.exposureEventId),
      slug: value.slug,
      sourceUrl:
        value.sourceUrl ??
        value.officialUrl ??
        `https://basketball.exposureevents.com/${value.exposureEventId}/${value.slug}`,
      name: value.name,
      organizer: value.organizer,
      sport: value.sport,
      sanctioningTags: value.sanctioningTags,
      gender: value.gender,
      ageOrGradeDivisions: value.ageOrGradeDivisions,
      venueName: value.venueName,
      city: value.city ?? cityState.city,
      state: value.state ?? cityState.state,
      region: value.region ?? value.state ?? cityState.state,
      startDate: value.startDate,
      endDate: value.endDate,
      location: value.location,
      officialUrl:
        value.officialUrl ??
        `https://basketball.exposureevents.com/${value.exposureEventId}/${value.slug}`,
      timezone: value.timezone,
      registeredTeamCount: value.registeredTeamCount,
      hasPublicTeamList: value.hasPublicTeamList,
      lastCheckedAt: value.lastCheckedAt,
      lastSyncedAt: value.lastSyncedAt,
      lastTeamChangeAt: value.lastTeamChangeAt,
      status: value.status,
      dropdownGroup: "tracked",
    };
  });

const MajorTournamentSourceSchema = z.object({
  name: z.string().trim().min(1),
  provider: z.enum(["exposure_events", "public_html", "aau_event_finder"]),
  enabled: z.coerce.boolean().default(true),
  url: z.string().trim().url().optional(),
  eventUrls: z.array(z.string().trim().url()).optional(),
  eventLinkPatterns: z.array(z.string().trim()).optional(),
  teamListUrlTemplates: z.array(z.string().trim()).optional(),
  teamListLinkPatterns: z.array(z.string().trim()).optional(),
  teamSelectors: z.array(z.string().trim()).optional(),
  maxEvents: z.coerce.number().optional(),
  maxTeamListPages: z.coerce.number().optional(),
  organizerName: z.string().trim().optional(),
  sanctioningTags: z.array(z.string().trim()).optional(),
  timezone: z.string().trim().optional(),
  region: z.string().trim().optional(),
});

export function configuredTournaments(): TournamentSource[] {
  const parsed = parseExposureEventsEnv(config.EXPOSURE_EVENTS);
  if (parsed.length > 0) return dedupeTournaments(parsed);

  if (
    config.EXPOSURE_EVENT_ID !== fallbackTournament.exposureEventId ||
    config.EXPOSURE_EVENT_SLUG !== fallbackTournament.slug
  ) {
    return [
      {
        ...fallbackTournament,
        id: `event-${config.EXPOSURE_EVENT_ID}`,
        exposureEventId: config.EXPOSURE_EVENT_ID,
        externalId: String(config.EXPOSURE_EVENT_ID),
        slug: config.EXPOSURE_EVENT_SLUG,
        sourceUrl: `https://basketball.exposureevents.com/${config.EXPOSURE_EVENT_ID}/${config.EXPOSURE_EVENT_SLUG}`,
        name: "Configured Tournament",
        organizer: "Youth Basketball Tournament",
        officialUrl: `https://basketball.exposureevents.com/${config.EXPOSURE_EVENT_ID}/${config.EXPOSURE_EVENT_SLUG}`,
      },
    ];
  }

  return defaultTrackedTournaments;
}

export function defaultTournament(): TournamentSource {
  const tournaments = configuredTournaments();
  const configuredDefault = config.DEFAULT_EXPOSURE_EVENT_ID;
  return (
    tournaments.find((event) => event.exposureEventId === configuredDefault) ??
    tournaments.find(
      (event) => event.exposureEventId === fallbackTournament.exposureEventId,
    ) ??
    tournaments[0] ??
    fallbackTournament
  );
}

export function tournamentForExposureEventId(
  exposureEventId?: number | null,
): TournamentSource {
  const tournaments = configuredTournaments();
  if (!exposureEventId) return defaultTournament();
  return (
    tournaments.find((event) => event.exposureEventId === exposureEventId) ?? {
      ...fallbackTournament,
      id: `event-${exposureEventId}`,
      exposureEventId,
      externalProvider: "exposure_events",
      externalId: String(exposureEventId),
      slug: String(exposureEventId),
      sourceUrl: `https://basketball.exposureevents.com/${exposureEventId}`,
      name: `Exposure Event ${exposureEventId}`,
      organizer: "Youth Basketball Tournament",
      sport: "basketball",
      sanctioningTags: ["Exposure Events"],
      gender: null,
      ageOrGradeDivisions: [],
      venueName: null,
      city: null,
      state: null,
      region: null,
      officialUrl: `https://basketball.exposureevents.com/${exposureEventId}`,
      startDate: fallbackTournament.startDate,
      endDate: fallbackTournament.endDate,
      location: "Location TBD",
      registeredTeamCount: 0,
      hasPublicTeamList: false,
      lastCheckedAt: null,
      lastSyncedAt: null,
      lastTeamChangeAt: null,
      status: "upcoming",
      dropdownGroup: "tracked",
    }
  );
}

export function majorTournamentSources(): MajorTournamentSource[] {
  if (!config.TOURNAMENT_DISCOVERY_ENABLED) return [];
  if (!config.MAJOR_TOURNAMENT_SOURCES?.trim())
    return DEFAULT_MAJOR_TOURNAMENT_SOURCES;
  try {
    const value = JSON.parse(config.MAJOR_TOURNAMENT_SOURCES) as unknown;
    const arrayValue = Array.isArray(value) ? value : [value];
    return arrayValue.map((item) => MajorTournamentSourceSchema.parse(item));
  } catch (error) {
    throw new Error(
      `MAJOR_TOURNAMENT_SOURCES must be valid JSON: ${error instanceof Error ? error.message : "unknown parse error"}`,
    );
  }
}

function parseExposureEventsEnv(raw: string | undefined): TournamentSource[] {
  if (!raw?.trim()) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    const arrayValue = Array.isArray(value) ? value : [value];
    return arrayValue.map((item) => TournamentSourceSchema.parse(item));
  } catch (error) {
    throw new Error(
      `EXPOSURE_EVENTS must be valid JSON: ${error instanceof Error ? error.message : "unknown parse error"}`,
    );
  }
}

function dedupeTournaments(
  tournaments: TournamentSource[],
): TournamentSource[] {
  const byExposureId = new Map<number, TournamentSource>();
  for (const tournament of tournaments)
    byExposureId.set(tournament.exposureEventId, tournament);
  return Array.from(byExposureId.values());
}

function splitCityState(location: string): {
  city: string | null;
  state: string | null;
} {
  const [city, ...rest] = location
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return { city: city ?? null, state: rest.join(", ") || null };
}
