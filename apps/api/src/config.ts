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
  TOURNAMENT_DISCOVERY_INTERVAL_HOURS: z.coerce.number().default(6),
  TOURNAMENT_DISCOVERY_WINDOW_DAYS: z.coerce.number().default(183),
  TOURNAMENT_DROPDOWN_CACHE_HOURS: z.coerce.number().default(720),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  PUSH_CONTACT_EMAIL: z.string().default("mailto:admin@example.com"),
  JWT_SECRET: z.string().optional(),
  ADMIN_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  PASSWORD_RESET_FROM_EMAIL: z
    .string()
    .default("Court Watch AAU <no-reply@courtwatchaau.com>"),
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

const gsgBamNorcalCollisionTournament: TournamentSource = {
  id: "event-gsg-bam-norcal-collision-2026",
  exposureEventId: 264313,
  externalProvider: "exposure_events",
  externalId: "264313",
  slug: "gsg-x-bam-norcal-collision",
  sourceUrl:
    "https://basketball.exposureevents.com/264313/gsg-x-bam-norcal-collision",
  name: "GSG x BAM - NorCal Collision",
  organizer: "GSG Hoops",
  sport: "basketball",
  sanctioningTags: [
    "GSG Hoops",
    "Golden State Games",
    "BAM",
    "BAMTOURNAMENTS",
    "BAM x GSG",
    "NorCal",
    "Exposure Events",
  ],
  gender: "Boys & Girls",
  ageOrGradeDivisions: ["8U", "17U"],
  venueName: null,
  city: "San Ramon",
  state: "CA",
  region: "Northern California",
  startDate: "2026-06-06",
  endDate: "2026-06-07",
  location: "San Ramon, CA",
  officialUrl:
    "https://basketball.exposureevents.com/264313/gsg-x-bam-norcal-collision",
  timezone: DEFAULT_TOURNAMENT_TIMEZONE,
  registeredTeamCount: 0,
  hasPublicTeamList: false,
  lastCheckedAt: null,
  lastSyncedAt: null,
  lastTeamChangeAt: null,
  status: "upcoming",
  dropdownGroup: "tracked",
};

const eastBaySummerBattleTournament: TournamentSource = {
  id: "event-east-bay-summer-battle-2026",
  exposureEventId: 264314,
  externalProvider: "exposure_events",
  externalId: "264314",
  slug: "the-east-bay-summer-battle-powered-by-4ballers-only-x-gsg-x-justhoop",
  sourceUrl:
    "https://basketball.exposureevents.com/264314/the-east-bay-summer-battle-powered-by-4ballers-only-x-gsg-x-justhoop",
  name: "The East Bay Summer Battle - powered by 4Ballers Only x GSG x JustHoop",
  organizer: "GSG Hoops",
  sport: "basketball",
  sanctioningTags: [
    "GSG Hoops",
    "Golden State Games",
    "BAM",
    "BAMTOURNAMENTS",
    "BAM Tournaments",
    "Summer Challenge",
    "4Ballers Only",
    "JustHoop",
    "Exposure Events",
  ],
  gender: "Boys & Girls",
  ageOrGradeDivisions: [
    "2nd/3rd Grade",
    "4th Grade",
    "5th Grade",
    "6th Grade",
    "7th Grade",
    "8th Grade",
    "9th Grade",
    "10th Grade",
    "11th Grade",
    "12th Grade",
  ],
  venueName: "San Leandro High School",
  city: "San Leandro",
  state: "CA",
  region: "Northern California",
  startDate: "2026-06-13",
  endDate: "2026-06-14",
  location: "San Leandro & Surrounding Gyms, CA",
  officialUrl:
    "https://basketball.exposureevents.com/264314/the-east-bay-summer-battle-powered-by-4ballers-only-x-gsg-x-justhoop",
  timezone: DEFAULT_TOURNAMENT_TIMEZONE,
  registeredTeamCount: 0,
  hasPublicTeamList: false,
  lastCheckedAt: null,
  lastSyncedAt: null,
  lastTeamChangeAt: null,
  status: "upcoming",
  dropdownGroup: "tracked",
};

type GsgBamTournamentData = {
  exposureEventId: number;
  slug: string;
  name: string;
  startDate: string;
  endDate: string;
  location: string;
  city: string;
  tags?: string[];
};

const gsgBamSummerTournamentData = [
  {
    exposureEventId: 264315,
    slug: "gsg-x-bam-fathers-day-shootout",
    name: "GSG x BAM - Father's Day Shootout",
    startDate: "2026-06-20",
    endDate: "2026-06-21",
    location: "San Ramon/San Leandro/Oakland, CA",
    city: "San Ramon/San Leandro/Oakland",
  },
  {
    exposureEventId: 264316,
    slug: "bam-x-gsg-summer-slam",
    name: "BAM x GSG - Summer Slam",
    startDate: "2026-06-27",
    endDate: "2026-06-28",
    location: "San Ramon/San Leandro/Oakland, CA",
    city: "San Ramon/San Leandro/Oakland",
  },
  {
    exposureEventId: 264317,
    slug: "gsg-x-bam-july-4th-shootout",
    name: "GSG x BAM - July 4th Shootout",
    startDate: "2026-07-04",
    endDate: "2026-07-05",
    location: "San Ramon/San Leandro/Oakland, CA",
    city: "San Ramon/San Leandro/Oakland",
  },
  {
    exposureEventId: 264318,
    slug: "bam-x-gsg-norcal-summer-classic",
    name: "BAM x GSG - NorCal Summer Classic",
    startDate: "2026-07-11",
    endDate: "2026-07-12",
    location: "San Ramon, CA",
    city: "San Ramon",
    tags: ["NorCal"],
  },
  {
    exposureEventId: 264319,
    slug: "gsg-x-bam-summer-showdown",
    name: "GSG x BAM - Summer Showdown",
    startDate: "2026-07-18",
    endDate: "2026-07-19",
    location: "San Ramon/San Leandro/Oakland, CA",
    city: "San Ramon/San Leandro/Oakland",
  },
  {
    exposureEventId: 264320,
    slug: "bam-x-gsg-summer-jam",
    name: "BAM x GSG - Summer Jam",
    startDate: "2026-07-25",
    endDate: "2026-07-26",
    location: "San Ramon/San Leandro/Oakland, CA",
    city: "San Ramon/San Leandro/Oakland",
  },
  {
    exposureEventId: 264321,
    slug: "gsg-x-bam-summer-showcase",
    name: "GSG x BAM - Summer Showcase",
    startDate: "2026-08-01",
    endDate: "2026-08-02",
    location: "San Ramon/San Leandro/Oakland, CA",
    city: "San Ramon/San Leandro/Oakland",
  },
  {
    exposureEventId: 264322,
    slug: "king-of-cali-powered-by-battleground-circuit",
    name: "King of Cali powered by Battleground Circuit",
    startDate: "2026-08-08",
    endDate: "2026-08-09",
    location: "San Ramon/San Leandro/Oakland, CA",
    city: "San Ramon/San Leandro/Oakland",
    tags: ["Battleground Circuit", "King of Cali"],
  },
  {
    exposureEventId: 264323,
    slug: "bam-x-gsg-bay-area-hoopfest",
    name: "BAM x GSG - Bay Area HoopFest",
    startDate: "2026-08-15",
    endDate: "2026-08-16",
    location: "San Ramon/San Leandro/Oakland, CA",
    city: "San Ramon/San Leandro/Oakland",
  },
  {
    exposureEventId: 264324,
    slug: "gsg-x-bam-heat-check-classic",
    name: "GSG x BAM - Heat Check Classic",
    startDate: "2026-08-22",
    endDate: "2026-08-23",
    location: "San Ramon/San Leandro/Oakland, CA",
    city: "San Ramon/San Leandro/Oakland",
  },
  {
    exposureEventId: 264325,
    slug: "bam-x-gsg-summer-finale",
    name: "BAM x GSG - Summer Finale",
    startDate: "2026-08-29",
    endDate: "2026-08-30",
    location: "San Ramon/San Leandro/Oakland, CA",
    city: "San Ramon/San Leandro/Oakland",
  },
] satisfies GsgBamTournamentData[];

function gsgBamTournamentSource(
  tournament: GsgBamTournamentData,
): TournamentSource {
  const officialUrl = `https://basketball.exposureevents.com/${tournament.exposureEventId}/${tournament.slug}`;
  return {
    id: `event-${tournament.slug}-2026`,
    exposureEventId: tournament.exposureEventId,
    externalProvider: "exposure_events",
    externalId: String(tournament.exposureEventId),
    slug: tournament.slug,
    sourceUrl: officialUrl,
    name: tournament.name,
    organizer: "GSG Hoops",
    sport: "basketball",
    sanctioningTags: [
      "GSG Hoops",
      "Golden State Games",
      "BAM",
      "BAMTOURNAMENTS",
      "BAM Tournaments",
      "BAM x GSG",
      "Exposure Events",
      ...(tournament.tags ?? []),
    ],
    gender: "Boys & Girls",
    ageOrGradeDivisions: [],
    venueName: null,
    city: tournament.city,
    state: "CA",
    region: "Northern California",
    startDate: tournament.startDate,
    endDate: tournament.endDate,
    location: tournament.location,
    officialUrl,
    timezone: DEFAULT_TOURNAMENT_TIMEZONE,
    registeredTeamCount: 0,
    hasPublicTeamList: false,
    lastCheckedAt: null,
    lastSyncedAt: null,
    lastTeamChangeAt: null,
    status: "upcoming",
    dropdownGroup: "tracked",
  };
}

const gsgBamSummerTournaments = gsgBamSummerTournamentData.map(
  gsgBamTournamentSource,
);

type G365TournamentData = {
  exposureEventId: number;
  slug: string;
  name: string;
  startDate: string;
  endDate: string;
  location: string;
  city: string;
  state: string;
  region?: string;
};

const g365TournamentData = [
  {
    exposureEventId: 252627,
    slug: "g365-extravaganza",
    name: "G365 Extravaganza",
    startDate: "2026-06-06",
    endDate: "2026-06-07",
    location: "Anaheim / Ladera Ranch, CA",
    city: "Anaheim / Ladera Ranch",
    state: "CA",
    region: "Southern California",
  },
  {
    exposureEventId: 252628,
    slug: "g365-gold-rush",
    name: "G365 Gold Rush",
    startDate: "2026-06-06",
    endDate: "2026-06-07",
    location: "Oakland, CA",
    city: "Oakland",
    state: "CA",
    region: "Northern California",
  },
  {
    exposureEventId: 252629,
    slug: "g365-dance-in-the-desert",
    name: "G365 Dance in the Desert",
    startDate: "2026-06-06",
    endDate: "2026-06-07",
    location: "Avondale, AZ",
    city: "Avondale",
    state: "AZ",
    region: "Arizona",
  },
  {
    exposureEventId: 252630,
    slug: "g365-battle-in-the-valley",
    name: "G365 Battle in the Valley",
    startDate: "2026-06-20",
    endDate: "2026-06-21",
    location: "Newbury Park, CA",
    city: "Newbury Park",
    state: "CA",
    region: "Southern California",
  },
  {
    exposureEventId: 252631,
    slug: "g365-underground-classic",
    name: "G365 Underground Classic",
    startDate: "2026-06-20",
    endDate: "2026-06-21",
    location: "Corona, CA",
    city: "Corona",
    state: "CA",
    region: "Southern California",
  },
  {
    exposureEventId: 252632,
    slug: "g365-dallas-skyline-classic",
    name: "G365 Dallas Skyline Classic",
    startDate: "2026-06-20",
    endDate: "2026-06-21",
    location: "Arlington, TX",
    city: "Arlington",
    state: "TX",
    region: "Texas",
  },
  {
    exposureEventId: 252634,
    slug: "g365-jet-city",
    name: "G365 Jet City",
    startDate: "2026-06-20",
    endDate: "2026-06-21",
    location: "Auburn, WA",
    city: "Auburn",
    state: "WA",
    region: "Washington",
  },
  {
    exposureEventId: 252635,
    slug: "g365-the-finals",
    name: "G365 The Finals",
    startDate: "2026-06-26",
    endDate: "2026-06-28",
    location: "Anaheim / Ladera / Laguna Hills, CA",
    city: "Anaheim / Ladera / Laguna Hills",
    state: "CA",
    region: "Southern California",
  },
  {
    exposureEventId: 252639,
    slug: "g365-crown-city-classic",
    name: "G365 Crown City Classic",
    startDate: "2026-07-11",
    endDate: "2026-07-12",
    location: "Corona, CA",
    city: "Corona",
    state: "CA",
    region: "Southern California",
  },
  {
    exposureEventId: 252638,
    slug: "g365-vegas-marquee",
    name: "G365 Vegas Marquee",
    startDate: "2026-07-17",
    endDate: "2026-07-19",
    location: "Las Vegas, NV",
    city: "Las Vegas",
    state: "NV",
    region: "Nevada",
  },
  {
    exposureEventId: 252637,
    slug: "g365-nationals",
    name: "G365 Nationals",
    startDate: "2026-07-24",
    endDate: "2026-07-26",
    location: "Las Vegas, NV",
    city: "Las Vegas",
    state: "NV",
    region: "Nevada",
  },
  {
    exposureEventId: 252640,
    slug: "g365-summer-slam",
    name: "G365 Summer Slam",
    startDate: "2026-07-25",
    endDate: "2026-07-26",
    location: "Oakland, CA",
    city: "Oakland",
    state: "CA",
    region: "Northern California",
  },
  {
    exposureEventId: 252641,
    slug: "g365-sea-town-slam",
    name: "G365 Sea-Town Slam",
    startDate: "2026-08-01",
    endDate: "2026-08-02",
    location: "Auburn, WA",
    city: "Auburn",
    state: "WA",
    region: "Washington",
  },
  {
    exposureEventId: 252644,
    slug: "g365-the-crown",
    name: "G365 The Crown",
    startDate: "2026-08-08",
    endDate: "2026-08-09",
    location: "Oakland, CA",
    city: "Oakland",
    state: "CA",
    region: "Northern California",
  },
  {
    exposureEventId: 252645,
    slug: "g365-the-rise",
    name: "G365 The Rise",
    startDate: "2026-08-08",
    endDate: "2026-08-09",
    location: "Phoenix, AZ",
    city: "Phoenix",
    state: "AZ",
    region: "Arizona",
  },
  {
    exposureEventId: 252647,
    slug: "g365-summer-showdown",
    name: "G365 Summer Showdown",
    startDate: "2026-08-15",
    endDate: "2026-08-16",
    location: "Anaheim / Ladera Ranch, CA",
    city: "Anaheim / Ladera Ranch",
    state: "CA",
    region: "Southern California",
  },
] satisfies G365TournamentData[];

function g365TournamentSource(
  tournament: G365TournamentData,
): TournamentSource {
  const officialUrl = `https://basketball.exposureevents.com/${tournament.exposureEventId}/${tournament.slug}`;
  return {
    id: `event-${tournament.slug}-2026`,
    exposureEventId: tournament.exposureEventId,
    externalProvider: "exposure_events",
    externalId: String(tournament.exposureEventId),
    slug: tournament.slug,
    sourceUrl: officialUrl,
    name: tournament.name,
    organizer: "Grassroots 365",
    sport: "basketball",
    sanctioningTags: [
      "Grassroots 365",
      "G365",
      "Exposure Events",
      ...(tournament.region ? [tournament.region] : []),
    ],
    gender: "Boys & Girls",
    ageOrGradeDivisions: [],
    venueName: null,
    city: tournament.city,
    state: tournament.state,
    region: tournament.region ?? tournament.state,
    startDate: tournament.startDate,
    endDate: tournament.endDate,
    location: tournament.location,
    officialUrl,
    timezone: DEFAULT_TOURNAMENT_TIMEZONE,
    registeredTeamCount: 0,
    hasPublicTeamList: false,
    lastCheckedAt: null,
    lastSyncedAt: null,
    lastTeamChangeAt: null,
    status: "upcoming",
    dropdownGroup: "tracked",
  };
}

const g365Tournaments = g365TournamentData.map(g365TournamentSource);

const touchShootingTheStandardTournament: TournamentSource = {
  id: "event-the-standard-2026",
  exposureEventId: 267048,
  externalProvider: "exposure_events",
  externalId: "267048",
  slug: "the-standard",
  sourceUrl: "https://basketball.exposureevents.com/267048/the-standard",
  name: "The Standard",
  organizer: "Touch Shooting Premiere Events",
  sport: "basketball",
  sanctioningTags: [
    "Touch Shooting Premiere Events",
    "Northern California",
    "NorCal",
    "Exposure Events",
  ],
  gender: "Boys & Girls",
  ageOrGradeDivisions: [],
  venueName: null,
  city: "Sacramento",
  state: "CA",
  region: "Northern California",
  startDate: "2026-06-06",
  endDate: "2026-06-07",
  location: "Sacramento, CA",
  officialUrl: "https://basketball.exposureevents.com/267048/the-standard",
  timezone: DEFAULT_TOURNAMENT_TIMEZONE,
  registeredTeamCount: 0,
  hasPublicTeamList: false,
  lastCheckedAt: null,
  lastSyncedAt: null,
  lastTeamChangeAt: null,
  status: "upcoming",
  dropdownGroup: "tracked",
};

const hoop121FallFestTournament: TournamentSource = {
  id: "event-bay-area-fall-fest-2026",
  exposureEventId: 255459,
  externalProvider: "exposure_events",
  externalId: "255459",
  slug: "the-bay-area-fall-fest-invitational",
  sourceUrl:
    "https://basketball.exposureevents.com/255459/the-bay-area-fall-fest-invitational",
  name: "The Bay Area Fall Fest Invitational",
  organizer: "Hoop 121",
  sport: "basketball",
  sanctioningTags: [
    "Hoop 121",
    "Bay Area",
    "Northern California",
    "NorCal",
    "Exposure Events",
  ],
  gender: "Boys & Girls",
  ageOrGradeDivisions: [],
  venueName: null,
  city: "East Bay Area",
  state: "CA",
  region: "Northern California",
  startDate: "2026-11-07",
  endDate: "2026-11-08",
  location: "East Bay Area, CA",
  officialUrl:
    "https://basketball.exposureevents.com/255459/the-bay-area-fall-fest-invitational",
  timezone: DEFAULT_TOURNAMENT_TIMEZONE,
  registeredTeamCount: 0,
  hasPublicTeamList: false,
  lastCheckedAt: null,
  lastSyncedAt: null,
  lastTeamChangeAt: null,
  status: "upcoming",
  dropdownGroup: "tracked",
};

const hoop121FathersDayHoopFestTournament: TournamentSource = {
  id: "event-fathers-day-hoop-fest-2026",
  exposureEventId: 247158,
  externalProvider: "exposure_events",
  externalId: "247158",
  slug: "2026-fathers-day-hoop-fest",
  sourceUrl:
    "https://basketball.exposureevents.com/247158/2026-fathers-day-hoop-fest",
  name: "2026 Father's Day Hoop Fest!",
  organizer: "Hoop 121",
  sport: "basketball",
  sanctioningTags: [
    "Hoop 121",
    "Bay Area",
    "East Bay",
    "Northern California",
    "NorCal",
    "Exposure Events",
  ],
  gender: "Boys & Girls",
  ageOrGradeDivisions: ["8U", "17U"],
  venueName: "Chabot College",
  city: "Hayward",
  state: "CA",
  region: "Northern California",
  startDate: "2026-06-20",
  endDate: "2026-06-20",
  location: "Hayward, CA",
  officialUrl:
    "https://basketball.exposureevents.com/247158/2026-fathers-day-hoop-fest",
  timezone: DEFAULT_TOURNAMENT_TIMEZONE,
  registeredTeamCount: 0,
  hasPublicTeamList: true,
  lastCheckedAt: null,
  lastSyncedAt: null,
  lastTeamChangeAt: null,
  status: "upcoming",
  dropdownGroup: "tracked",
};

const hoop121SfTakeoverTournament: TournamentSource = {
  id: "event-sf-whph-sf-rebels-sf-takeover-2026",
  exposureEventId: 262891,
  externalProvider: "exposure_events",
  externalId: "262891",
  slug: "sf-whph-and-sf-rebels-sf-takeover",
  sourceUrl:
    "https://basketball.exposureevents.com/262891/sf-whph-and-sf-rebels-sf-takeover",
  name: "SF WHPH & SF Rebels - SF Takeover",
  organizer: "Hoop 121",
  sport: "basketball",
  sanctioningTags: [
    "Hoop 121",
    "SF WHPH",
    "SF Work Hard Play Hard",
    "SF Rebels",
    "Bay Area Takeover",
    "Bay Area",
    "Northern California",
    "NorCal",
    "Exposure Events",
  ],
  gender: "Boys & Girls",
  ageOrGradeDivisions: ["8U", "17U"],
  venueName: "Saint Ignatius High School",
  city: "San Francisco",
  state: "CA",
  region: "Northern California",
  startDate: "2026-05-30",
  endDate: "2026-05-31",
  location: "San Francisco, CA",
  officialUrl:
    "https://basketball.exposureevents.com/262891/sf-whph-and-sf-rebels-sf-takeover",
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
  gsgBamNorcalCollisionTournament,
  eastBaySummerBattleTournament,
  ...gsgBamSummerTournaments,
  ...g365Tournaments,
  touchShootingTheStandardTournament,
  hoop121FathersDayHoopFestTournament,
  hoop121SfTakeoverTournament,
  hoop121FallFestTournament,
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
  metadataOnly: z.coerce.boolean().optional(),
  directoryEventType: z.string().optional(),
  ignoreDiscoveryWindowEnd: z.coerce.boolean().optional(),
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
