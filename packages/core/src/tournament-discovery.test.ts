import { describe, expect, it, vi } from "vitest";
import {
  AauEventFinderTournamentProvider,
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
            "https://basketball.exposureevents.com/247158/2026-fathers-day-hoop-fest",
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
        expect.objectContaining({
          name: "Exposure Basketball Directory",
          provider: "aau_event_finder",
          enabled: false,
          url: "https://basketball.exposureevents.com/youth-basketball-events",
          maxEvents: 2600,
          metadataOnly: true,
          directoryEventType: "",
          ignoreDiscoveryWindowEnd: true,
          sanctioningTags: expect.arrayContaining(["Exposure Events"]),
        }),
      ]),
    );
  });

  it("keeps the default discovery set focused on CA/NV while broad feeds are disabled", () => {
    expect(DEFAULT_MAJOR_TOURNAMENT_SOURCES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Zero Gravity Basketball",
          enabled: false,
        }),
        expect.objectContaining({
          name: "Exposure Basketball Directory",
          enabled: false,
        }),
      ]),
    );
  });

  it("discovers global Exposure basketball directory events with the page token and session cookie", async () => {
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
          expect(init.headers).toMatchObject({
            "X-Exposure-Token": "public-token",
            Cookie: "exposure-session=test-session",
          });
          expect(String(init.body)).not.toContain("EventType=");
          expect(String(init.body)).not.toContain("EndDateString=");
          return jsonResponse({
            Results: [
              {
                Id: 250262,
                Name: "Big Shots Spring Nationals",
                Type: "Tournament",
                Link: "/250262/big-shots-spring-nationals",
                OrganizationName: "Big Shots",
                StartDate: "2026-06-06T00:00:00.000",
                EndDate: "2026-06-07T00:00:00.000",
                City: "Rock Hill",
                StateRegionAbbr: "SC",
                CityState: "Rock Hill, South Carolina",
                Location: "Rock Hill Sports & Event Center",
                YouthAgeGradesBoth: "Boys & Girls",
              },
              {
                Id: 252628,
                Name: "G365 Gold Rush",
                Type: "Tournament",
                Link: "https://basketball.exposureevents.com/252628/g365-gold-rush",
                OrganizationName: "Grassroots 365",
                StartDate: "2026-06-06T00:00:00.000",
                EndDate: "2026-06-06T00:00:00.000",
                CityState: "Oakland, California",
                StateRegionAbbr: "CA",
                Location: "Oakland, CA",
              },
              {
                Id: 266982,
                Name: "Cali Summer Showcase",
                Type: "Tournament",
                Link: "https://basketball.exposureevents.com/266982/cali-summer-showcase",
                OrganizationName: "Exposure Basketball Events",
                StartDate: "2026-06-13T00:00:00.000",
                EndDate: "2026-06-14T00:00:00.000",
                CityState: "Westminster, California",
                StateRegionAbbr: "CA",
                Location: "Westminster, CA",
              },
            ],
            Page: 1,
            PageSize: 50,
            Total: 3,
          });
        }
        if (url.endsWith("/youth-basketball-events")) {
          return new Response(
            `
              <script>
                app.viewModel.events.init({ tokenName: 'X-Exposure-Token', tokenValue: 'public-token' });
              </script>
            `,
            {
              status: 200,
              headers: {
                "Content-Type": "text/html",
                "Set-Cookie": "exposure-session=test-session; path=/",
              },
            },
          );
        }
        throw new Error(`Unhandled URL ${url}`);
      },
    ) as unknown as typeof fetch;

    const provider = new AauEventFinderTournamentProvider({
      baseUrl: "https://basketball.exposureevents.com",
      fetchImpl,
    });
    const events = await provider.discoverEvents(
      {
        name: "Exposure Basketball Directory",
        provider: "aau_event_finder",
        enabled: true,
        url: "https://basketball.exposureevents.com/youth-basketball-events",
        maxEvents: 2600,
        directoryEventType: "",
        ignoreDiscoveryWindowEnd: true,
        organizerName: "Exposure Basketball Events",
        sanctioningTags: ["Exposure Events"],
      },
      {
        startDate: "2026-06-06",
        endDate: "2026-12-06",
        now: new Date("2026-06-06T12:00:00.000Z"),
      },
    );

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      exposureEventId: 250262,
      externalProvider: "exposure_events",
      name: "Big Shots Spring Nationals",
      organizer: "Big Shots",
      city: "Rock Hill",
      state: "SC",
      location: "Rock Hill, South Carolina",
      venueName: "Rock Hill Sports & Event Center",
      hasPublicTeamList: false,
    });
    expect(events[1]).toMatchObject({
      exposureEventId: 252628,
      name: "G365 Gold Rush",
      region: "Northern California",
    });
    expect(events[2]).toMatchObject({
      exposureEventId: 266982,
      name: "Cali Summer Showcase",
      region: "Southern California",
    });
  });

  it("stores metadata-only directory discoveries without fetching every team list", async () => {
    const event = {
      id: "event-930001",
      exposureEventId: 930001,
      externalProvider: "exposure_events",
      externalId: "930001",
      slug: "directory-only-classic",
      sourceUrl:
        "https://basketball.exposureevents.com/930001/directory-only-classic",
      name: "Directory Only Classic",
      organizer: "Exposure Basketball Events",
      sport: "basketball",
      sanctioningTags: ["Exposure Events"],
      gender: null,
      ageOrGradeDivisions: [],
      venueName: null,
      city: "Hayward",
      state: "CA",
      region: "Northern California",
      startDate: "2026-07-20",
      endDate: "2026-07-21",
      location: "Hayward, CA",
      officialUrl:
        "https://basketball.exposureevents.com/930001/directory-only-classic",
      timezone: "America/Los_Angeles",
      registeredTeamCount: 0,
      hasPublicTeamList: false,
      lastCheckedAt: null,
      lastSyncedAt: null,
      lastTeamChangeAt: null,
      status: "upcoming" as const,
      dropdownGroup: "upcoming" as const,
    };
    const fetchRegisteredTeams = vi.fn(async () => {
      throw new Error("metadata-only source should not fetch team pages");
    });
    const provider: TournamentProvider = {
      providerName: "aau_event_finder",
      supportsPublicTeamLists: true,
      discoverEvents: async () => [event],
      fetchRegisteredTeams,
    };

    const result = await new TournamentDiscoveryService([provider]).discover(
      [
        {
          name: "Exposure Basketball Directory",
          provider: "aau_event_finder",
          enabled: true,
          metadataOnly: true,
        },
      ],
      { now: new Date("2026-06-06T12:00:00.000Z") },
    );

    expect(fetchRegisteredTeams).not.toHaveBeenCalled();
    expect(result.failures).toEqual([]);
    expect(result.candidates).toEqual([
      {
        event: expect.objectContaining({
          exposureEventId: 930001,
          hasPublicTeamList: false,
          lastCheckedAt: expect.any(String),
        }),
        teams: { divisions: [], teams: [] },
      },
    ]);
  });

  it("hydrates active metadata-only Exposure events when teams are published", async () => {
    const event = {
      id: "event-930002",
      exposureEventId: 930002,
      externalProvider: "exposure_events",
      externalId: "930002",
      slug: "active-directory-classic",
      sourceUrl:
        "https://basketball.exposureevents.com/930002/active-directory-classic",
      name: "Active Directory Classic",
      organizer: "Exposure Basketball Events",
      sport: "basketball",
      sanctioningTags: ["Exposure Events"],
      gender: null,
      ageOrGradeDivisions: [],
      venueName: null,
      city: "Roseville",
      state: "CA",
      region: "Northern California",
      startDate: "2026-06-06",
      endDate: "2026-06-07",
      location: "Roseville, CA",
      officialUrl:
        "https://basketball.exposureevents.com/930002/active-directory-classic",
      timezone: "America/Los_Angeles",
      registeredTeamCount: 0,
      hasPublicTeamList: false,
      lastCheckedAt: null,
      lastSyncedAt: null,
      lastTeamChangeAt: null,
      status: "upcoming" as const,
      dropdownGroup: "upcoming" as const,
    };
    const fetchRegisteredTeams = vi.fn(async () => ({
      divisions: [
        {
          id: "division-930002-11u",
          eventId: event.id,
          exposureDivisionId: "930002-11u",
          name: "11U/5th Grade",
          gender: "boys",
          gradeLevel: "5TH",
          level: null,
          rawJson: {},
        },
      ],
      teams: [
        {
          id: "team-930002-707-soldiers",
          eventId: event.id,
          divisionId: "division-930002-11u",
          exposureTeamId: "707-soldiers",
          name: "707 Soldiers",
          normalizedName: "707 soldiers",
          clubName: null,
          normalizedClubName: null,
          coachName: null,
          sourceUrl:
            "https://basketball.exposureevents.com/930002/active-directory-classic/teams/707-soldiers",
          rawJson: {},
          lastSeenAt: "2026-06-06T12:00:00.000Z",
        },
      ],
    }));
    const provider: TournamentProvider = {
      providerName: "aau_event_finder",
      supportsPublicTeamLists: true,
      discoverEvents: async () => [event],
      fetchRegisteredTeams,
    };

    const result = await new TournamentDiscoveryService([provider]).discover(
      [
        {
          name: "Exposure Basketball Directory",
          provider: "aau_event_finder",
          enabled: true,
          metadataOnly: true,
        },
      ],
      { now: new Date("2026-06-06T12:00:00.000Z") },
    );

    expect(fetchRegisteredTeams).toHaveBeenCalledTimes(1);
    expect(result.failures).toEqual([]);
    expect(result.candidates[0]).toMatchObject({
      event: {
        exposureEventId: 930002,
        hasPublicTeamList: true,
        registeredTeamCount: 1,
        status: "active",
      },
      teams: {
        teams: [{ name: "707 Soldiers" }],
      },
    });
  });

  it("includes Exposure/Jam On It-style public tournaments and skips stale event URLs", async () => {
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
        if (url.endsWith("/910000/stale-classic")) {
          return new Response("gone", {
            status: 410,
            headers: { "Content-Type": "text/html" },
          });
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
          eventUrls: [
            "https://basketball.exposureevents.com/910000/stale-classic",
          ],
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
    ]);
    expect(
      result.candidates.map((candidate) => candidate.event.region),
    ).toEqual(["Northern California"]);
    expect(result.candidates.map((candidate) => candidate.event.state)).toEqual(
      ["CA"],
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
        return htmlResponse('<a href="/bay-hoop-classic">Bay Hoop Classic</a>');
      }
      if (url.endsWith("/bay-hoop-classic")) {
        return htmlResponse(`
          <html>
            <head><title>Bay Hoop Classic - Jun 15-16, 2026 - Oakland, CA</title></head>
            <body>
              <h1>Bay Hoop Classic</h1>
              <p>Major grassroots basketball tournament.</p>
              <a href="/bay-hoop-classic/teams">Registered Teams</a>
            </body>
          </html>
        `);
      }
      if (url.endsWith("/bay-hoop-classic/teams")) {
        return htmlResponse(`
          <html>
            <head><title>Bay Hoop Classic Registered Teams</title></head>
            <body>
              <h1>Registered Teams</h1>
              <div data-team-name="Oakland Elite" data-division="Boys 8th Grade"></div>
              <div data-team-name="Bay Select" data-division="Boys 8th Grade"></div>
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
          eventLinkPatterns: ["bay-hoop-classic"],
          teamSelectors: ["[data-team-name]"],
          organizerName: "Metro Hoops",
          sanctioningTags: ["Grassroots"],
          timezone: "America/Los_Angeles",
        },
      ],
      { now: new Date("2026-05-24T12:00:00.000Z") },
    );

    expect(result.failures).toEqual([]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.event).toMatchObject({
      externalProvider: "public_html",
      externalId: "public-hoops.example/bay-hoop-classic",
      name: "Bay Hoop Classic",
      organizer: "Metro Hoops",
      city: "Oakland",
      state: "CA",
      registeredTeamCount: 2,
      hasPublicTeamList: true,
    });
    expect(result.candidates[0]?.teams.teams.map((team) => team.name)).toEqual([
      "Oakland Elite",
      "Bay Select",
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
            <head><title>Teams Hidden Classic - Jun 15-16, 2026 - Oakland, CA</title></head>
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
      city: "Reno",
      state: "NV",
      region: "Nevada",
      startDate: "2026-06-15",
      endDate: "2026-06-16",
      location: "Reno, NV",
      officialUrl: "https://basketball.exposureevents.com/910100/same-classic",
      timezone: "America/Los_Angeles",
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
