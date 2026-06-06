import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAJOR_TOURNAMENT_SOURCES,
  ExposureEventsTournamentProvider,
  PublicHtmlTournamentProvider,
  TournamentDiscoveryService,
  type TournamentProvider,
} from "./tournament-discovery.js";

function htmlResponse(value: string) {
  return new Response(value, {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("TournamentDiscoveryService", () => {
  it("tracks trusted Exposure organizer sources for Bay Area and NorCal discovery", () => {
    expect(DEFAULT_MAJOR_TOURNAMENT_SOURCES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "GSG Hoops",
          provider: "exposure_events",
          url: "https://basketball.exposureevents.com/organizations/33328/gsg-hoops",
          eventUrls: expect.arrayContaining([
            "https://basketball.exposureevents.com/264312/bam-x-gsg-spring-finale",
          ]),
          sanctioningTags: expect.arrayContaining([
            "GSG Hoops",
            "Golden State Games",
            "BAM x GSG",
          ]),
        }),
        expect.objectContaining({
          name: "BAMTOURNAMENTS",
          provider: "exposure_events",
          url: "https://basketball.exposureevents.com/organizations/27132/bamtournaments",
          sanctioningTags: expect.arrayContaining([
            "BAM",
            "BAMTOURNAMENTS",
            "BAM x GSG",
          ]),
        }),
        expect.objectContaining({
          name: "Touch Shooting Premiere Events",
          provider: "exposure_events",
          url: "https://basketball.exposureevents.com/organizations/33845/touch-shooting-premiere-events",
          eventUrls: expect.arrayContaining([
            "https://basketball.exposureevents.com/267048/the-standard",
          ]),
          sanctioningTags: expect.arrayContaining([
            "Northern California",
            "NorCal",
          ]),
        }),
        expect.objectContaining({
          name: "Hoop 121",
          provider: "exposure_events",
          url: "https://basketball.exposureevents.com/organizations/12589/hoop-121",
          eventUrls: expect.arrayContaining([
            "https://basketball.exposureevents.com/262891/sf-whph-and-sf-rebels-sf-takeover",
            "https://basketball.exposureevents.com/255459/the-bay-area-fall-fest-invitational",
          ]),
          sanctioningTags: expect.arrayContaining([
            "Bay Area",
            "Northern California",
          ]),
        }),
        expect.objectContaining({
          name: "NorCal Sports TV",
          provider: "exposure_events",
          url: "https://basketball.exposureevents.com/organizations/27463/norcal-sports-tv",
          eventUrls: expect.arrayContaining([
            "https://basketball.exposureevents.com/262086/ncstv-valley-exposure-tour",
          ]),
          sanctioningTags: expect.arrayContaining([
            "NorCal Sports TV",
            "NorCal",
          ]),
        }),
        expect.objectContaining({
          name: "Bay Area Stars Academy",
          provider: "exposure_events",
          url: "https://basketball.exposureevents.com/organizations/35401/bay-area-stars-academy",
          sanctioningTags: expect.arrayContaining([
            "Bay Area Stars",
            "Northern California",
          ]),
        }),
      ]),
    );
  });

  it("includes Exposure/Jam On It-style public tournaments when the public team list is reachable", async () => {
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/robots.txt")) {
          return new Response("User-agent: *\nDisallow: *.pdf$\nAllow: /\n", {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          });
        }
        if (init?.method === "POST") {
          return jsonResponse({
            Results: [
              { Link: "/910001/jam-on-it-memorial-day-classic" },
              { Link: "/910002/jam-on-it-teams-pending" },
              { Link: "/910001/jam-on-it-memorial-day-classic" },
            ],
          });
        }
        if (url.endsWith("/organizations/3461/jam-on-it")) {
          return htmlResponse(`
          <script>
            app.viewModel.events.init({ tokenName: 'X-Exposure-Token', tokenValue: 'public-token' });
          </script>
        `);
        }
        if (
          url.endsWith(
            "/910001/jam-on-it-memorial-day-classic/search?eventid=910001&eventname=jam-on-it-memorial-day-classic",
          )
        ) {
          return jsonResponse({
            Teams: [
              {
                Division: "Boys 8th Level 1",
                DivisionId: 1,
                Slug: "reno-hype",
                Value: 1001,
                Name: "Reno Hype (Boys 8th Level 1)",
              },
            ],
          });
        }
        if (
          url.endsWith(
            "/910002/jam-on-it-teams-pending/search?eventid=910002&eventname=jam-on-it-teams-pending",
          )
        ) {
          return jsonResponse({ Teams: [] });
        }
        if (url.endsWith("/910002/jam-on-it-teams-pending/teams")) {
          return htmlResponse(
            '<html><body><div id="content"></div></body></html>',
          );
        }
        if (url.endsWith("/910001/jam-on-it-memorial-day-classic")) {
          return htmlResponse(`
          <html>
            <head>
              <title>Jam On It Memorial Day Classic - May 25-27, 2026 - Reno, NV</title>
              <meta name="twitter:title" content="Jam On It Memorial Day Classic" />
            </head>
            <body><a href="/organizations/3461/jam-on-it">Jam On It</a> Exposure Certified AAU Licensed Boys & Girls</body>
          </html>
        `);
        }
        if (url.endsWith("/910002/jam-on-it-teams-pending")) {
          return htmlResponse(`
          <html>
            <head>
              <title>Jam On It Teams Pending - May 26-27, 2026 - Reno, NV</title>
              <meta name="twitter:title" content="Jam On It Teams Pending" />
            </head>
            <body><a href="/organizations/3461/jam-on-it">Jam On It</a></body>
          </html>
        `);
        }
        throw new Error(`Unhandled URL ${url}`);
      },
    ) as unknown as typeof fetch;

    const provider = new ExposureEventsTournamentProvider({
      baseUrl: "https://basketball.exposureevents.com",
      fetchImpl,
    });
    const result = await new TournamentDiscoveryService([provider]).discover(
      [
        {
          name: "Jam On It",
          provider: "exposure_events",
          enabled: true,
          url: "https://basketball.exposureevents.com/organizations/3461/jam-on-it",
          organizerName: "Jam On It",
        },
      ],
      { now: new Date("2026-05-24T12:00:00.000Z") },
    );

    expect(result.failures).toEqual([]);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]?.event).toMatchObject({
      name: "Jam On It Memorial Day Classic",
      exposureEventId: 910001,
      city: "Reno",
      state: "NV",
      registeredTeamCount: 1,
      hasPublicTeamList: true,
    });
    expect(result.candidates[0]?.teams.teams[0]?.name).toBe("Reno Hype");
    expect(result.candidates[1]?.event).toMatchObject({
      name: "Jam On It Teams Pending",
      exposureEventId: 910002,
      registeredTeamCount: 0,
      hasPublicTeamList: true,
    });
  });

  it("paginates Exposure organizer directories and derives regions from event locations", async () => {
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/robots.txt")) {
          return new Response("User-agent: *\nAllow: /\n", {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          });
        }
        if (init?.method === "POST") {
          const body = String(init.body ?? "");
          const page = new URLSearchParams(body).get("Page");
          return jsonResponse({
            Results:
              page === "2"
                ? [{ Link: "/920002/desert-classic" }]
                : [{ Link: "/920001/bakersfield-classic" }],
            Page: page,
            PageSize: 1,
            Total: 2,
          });
        }
        if (url.endsWith("/organizations/99999/test-source")) {
          return htmlResponse(`
            <script>
              app.viewModel.events.init({ tokenName: 'X-Exposure-Token', tokenValue: 'public-token' });
            </script>
          `);
        }
        if (
          url.endsWith(
            "/920001/bakersfield-classic/search?eventid=920001&eventname=bakersfield-classic",
          )
        ) {
          return jsonResponse({
            Teams: [
              {
                Division: "Boys 5th Grade",
                DivisionId: 11,
                Slug: "central-select",
                Value: 501,
                Name: "Central Select (Boys 5th Grade)",
              },
            ],
          });
        }
        if (
          url.endsWith(
            "/920002/desert-classic/search?eventid=920002&eventname=desert-classic",
          )
        ) {
          return jsonResponse({
            Teams: [
              {
                Division: "Boys 6th Grade",
                DivisionId: 12,
                Slug: "desert-select",
                Value: 601,
                Name: "Desert Select (Boys 6th Grade)",
              },
            ],
          });
        }
        if (url.endsWith("/920001/bakersfield-classic")) {
          return htmlResponse(`
            <html>
              <head>
                <title>Bakersfield Classic - June 20-21, 2026 - Bakersfield, CA</title>
                <meta name="twitter:title" content="Bakersfield Classic" />
              </head>
              <body><a href="/organizations/99999/test-source">Test Source</a></body>
            </html>
          `);
        }
        if (url.endsWith("/920002/desert-classic")) {
          return htmlResponse(`
            <html>
              <head>
                <title>Desert Classic - June 20-21, 2026 - Avondale, AZ</title>
                <meta name="twitter:title" content="Desert Classic" />
              </head>
              <body><a href="/organizations/99999/test-source">Test Source</a></body>
            </html>
          `);
        }
        throw new Error(`Unhandled URL ${url}`);
      },
    ) as unknown as typeof fetch;

    const provider = new ExposureEventsTournamentProvider({
      baseUrl: "https://basketball.exposureevents.com",
      fetchImpl,
    });
    const result = await new TournamentDiscoveryService([provider]).discover(
      [
        {
          name: "Test Source",
          provider: "exposure_events",
          enabled: true,
          url: "https://basketball.exposureevents.com/organizations/99999/test-source",
          organizerName: "Test Source",
          region: "Northern California",
        },
      ],
      { now: new Date("2026-06-05T12:00:00.000Z") },
    );

    expect(result.failures).toEqual([]);
    expect(result.candidates.map((candidate) => candidate.event.name)).toEqual([
      "Bakersfield Classic",
      "Desert Classic",
    ]);
    expect(
      result.candidates.map((candidate) => candidate.event.region),
    ).toEqual(["Northern California", "AZ"]);
    expect(result.candidates.map((candidate) => candidate.event.state)).toEqual(
      ["CA", "AZ"],
    );
  });

  it("includes non-Exposure public HTML tournaments when a public team-list page is reachable", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/robots.txt"))
        return new Response("User-agent: *\nAllow: /\n", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      if (url.endsWith("/events")) {
        return htmlResponse(
          '<a href="/metro-hoop-classic">Metro Hoop Classic</a>',
        );
      }
      if (url.endsWith("/metro-hoop-classic")) {
        return htmlResponse(`
          <html>
            <head><title>Metro Hoop Classic - Jun 15-16, 2026 - Phoenix, AZ</title></head>
            <body>
              <h1>Metro Hoop Classic</h1>
              <p>Major grassroots basketball tournament.</p>
              <a href="/metro-hoop-classic/teams">Registered Teams</a>
            </body>
          </html>
        `);
      }
      if (url.endsWith("/metro-hoop-classic/teams")) {
        return htmlResponse(`
          <html>
            <head><title>Metro Hoop Classic Registered Teams</title></head>
            <body>
              <h1>Registered Teams</h1>
              <div data-team-name="Phoenix Elite" data-division="Boys 8th Grade"></div>
              <div data-team-name="Desert Select" data-division="Boys 8th Grade"></div>
            </body>
          </html>
        `);
      }
      throw new Error(`Unhandled URL ${url}`);
    }) as unknown as typeof fetch;

    const provider = new PublicHtmlTournamentProvider({ fetchImpl });
    const result = await new TournamentDiscoveryService([provider]).discover(
      [
        {
          name: "Metro Public Source",
          provider: "public_html",
          enabled: true,
          url: "https://public-hoops.example/events",
          eventLinkPatterns: ["metro-hoop-classic"],
          teamSelectors: ["[data-team-name]"],
          organizerName: "Metro Hoops",
          sanctioningTags: ["Grassroots"],
          timezone: "America/Phoenix",
        },
      ],
      { now: new Date("2026-05-24T12:00:00.000Z") },
    );

    expect(result.failures).toEqual([]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.event).toMatchObject({
      externalProvider: "public_html",
      externalId: "public-hoops.example/metro-hoop-classic",
      name: "Metro Hoop Classic",
      organizer: "Metro Hoops",
      city: "Phoenix",
      state: "AZ",
      registeredTeamCount: 2,
      hasPublicTeamList: true,
    });
    expect(result.candidates[0]?.teams.teams.map((team) => team.name)).toEqual([
      "Phoenix Elite",
      "Desert Select",
    ]);
  });

  it("skips non-Exposure public HTML tournaments when no public team list can be found", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/robots.txt"))
        return new Response("User-agent: *\nAllow: /\n", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      if (url.endsWith("/teams-hidden")) {
        return htmlResponse(`
          <html>
            <head><title>Teams Hidden Classic - Jun 15-16, 2026 - Phoenix, AZ</title></head>
            <body><h1>Teams Hidden Classic</h1><p>Basketball tournament.</p></body>
          </html>
        `);
      }
      throw new Error(`Unhandled URL ${url}`);
    }) as unknown as typeof fetch;

    const provider = new PublicHtmlTournamentProvider({ fetchImpl });
    const result = await new TournamentDiscoveryService([provider]).discover(
      [
        {
          name: "Metro Public Source",
          provider: "public_html",
          enabled: true,
          eventUrls: ["https://public-hoops.example/teams-hidden"],
          organizerName: "Metro Hoops",
          sanctioningTags: ["Basketball"],
        },
      ],
      { now: new Date("2026-05-24T12:00:00.000Z") },
    );

    expect(result.candidates).toEqual([]);
    expect(result.failures).toEqual([
      {
        provider: "public_html",
        source: "https://public-hoops.example/teams-hidden",
        message: "No reachable public team-list page was found for this event.",
      },
    ]);
  });

  it("respects robots.txt for public HTML tournament discovery", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/robots.txt"))
        return new Response("User-agent: *\nDisallow: /\n", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      throw new Error(`robots.txt should block before fetching ${url}`);
    }) as unknown as typeof fetch;

    const provider = new PublicHtmlTournamentProvider({ fetchImpl });
    const result = await new TournamentDiscoveryService([provider]).discover(
      [
        {
          name: "Blocked Public Source",
          provider: "public_html",
          enabled: true,
          eventUrls: ["https://blocked-hoops.example/blocked-classic"],
          sanctioningTags: ["Basketball"],
        },
      ],
      { now: new Date("2026-05-24T12:00:00.000Z") },
    );

    expect(result.candidates).toEqual([]);
    expect(result.failures[0]).toMatchObject({
      provider: "public_html",
      source: "Blocked Public Source",
    });
    expect(result.failures[0]?.message).toContain("robots.txt disallows");
  });

  it("dedupes tournaments discovered by different public providers", async () => {
    const event = {
      id: "event-910100",
      exposureEventId: 910100,
      externalProvider: "exposure_events",
      externalId: "910100",
      slug: "same-classic",
      sourceUrl: "https://basketball.exposureevents.com/910100/same-classic",
      name: "Same Classic",
      organizer: "Public Organizer",
      sport: "basketball",
      sanctioningTags: ["Exposure Events"],
      gender: null,
      ageOrGradeDivisions: [],
      venueName: null,
      city: "Phoenix",
      state: "AZ",
      region: "AZ",
      startDate: "2026-06-15",
      endDate: "2026-06-16",
      location: "Phoenix, AZ",
      officialUrl: "https://basketball.exposureevents.com/910100/same-classic",
      timezone: "America/Phoenix",
      registeredTeamCount: 0,
      hasPublicTeamList: false,
      lastCheckedAt: null,
      lastSyncedAt: null,
      lastTeamChangeAt: null,
      status: "upcoming",
      dropdownGroup: "upcoming" as const,
    };
    const exposureProvider: TournamentProvider = {
      providerName: "exposure_events",
      supportsPublicTeamLists: true,
      discoverEvents: async () => [event],
      fetchRegisteredTeams: async () => ({ divisions: [], teams: [] }),
    };
    const publicHtmlProvider: TournamentProvider = {
      providerName: "public_html",
      supportsPublicTeamLists: true,
      discoverEvents: async () => [
        {
          ...event,
          id: "event-1800000000",
          exposureEventId: 1800000000,
          externalProvider: "public_html",
          externalId: "same-classic-public",
        },
      ],
      fetchRegisteredTeams: async () => ({ divisions: [], teams: [] }),
    };

    const result = await new TournamentDiscoveryService([
      exposureProvider,
      publicHtmlProvider,
    ]).discover(
      [
        { name: "Exposure Source", provider: "exposure_events", enabled: true },
        { name: "Public Source", provider: "public_html", enabled: true },
      ],
      { now: new Date("2026-05-24T12:00:00.000Z") },
    );

    expect(result.failures).toEqual([]);
    expect(
      result.candidates.map((candidate) => candidate.event.externalProvider),
    ).toEqual(["exposure_events"]);
  });

  it("does not crash dropdown discovery when a provider fails", async () => {
    const failingProvider: TournamentProvider = {
      providerName: "exposure_events",
      supportsPublicTeamLists: true,
      discoverEvents: async () => {
        throw new Error("source unavailable");
      },
      fetchRegisteredTeams: async () => ({ divisions: [], teams: [] }),
    };

    const result = await new TournamentDiscoveryService([
      failingProvider,
    ]).discover(
      [{ name: "Broken Source", provider: "exposure_events", enabled: true }],
      {
        now: new Date("2026-05-24T12:00:00.000Z"),
      },
    );

    expect(result.candidates).toEqual([]);
    expect(result.failures).toEqual([
      {
        provider: "exposure_events",
        source: "Broken Source",
        message: "source unavailable",
      },
    ]);
  });
});
