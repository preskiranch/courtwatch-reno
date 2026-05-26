import { describe, expect, it, vi } from "vitest";
import { PublicExposurePageClient } from "./public-exposure-page-client.js";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function htmlResponse(value: string) {
  return new Response(value, {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}

describe("PublicExposurePageClient", () => {
  it("uses the public search endpoint so teams keep Exposure division-team ids", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        Teams: [
          {
            Division: "Boys 2nd/3rd Level 3 Blue",
            DivisionId: 1278469,
            Slug: "splash-city",
            Value: 5168259,
            Name: "Splash City (Boys 2nd/3rd Level 3 Blue)",
          },
        ],
        Players: [],
      }),
    ) as unknown as typeof fetch;

    const result = await new PublicExposurePageClient({
      baseUrl: "https://basketball.exposureevents.com",
      fetchImpl,
    }).fetchTeams(255539);

    expect(result.divisions[0]?.id).toBe("division-255539-1278469");
    expect(result.teams[0]).toMatchObject({
      id: "public-team-255539-5168259",
      exposureTeamId: "5168259",
      name: "Splash City",
      divisionId: "division-255539-1278469",
    });
  });

  it("maps public eventgames into real games with courts and bracket links without inventing finals", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/schedule")) {
        return htmlResponse(`
          <script>
            app.viewModel.schedule.init({
              divisions: [{"Id":1278469,"Name":"Boys 2nd/3rd Level 3 Blue"}],
              standingsUrl: "/standings",
              brackets: [{"Id":784213,"Name":"Championship","DivisionId":1278469,"CrossDivisionIds":[],"ShowStandings":false}],
              searchUrl: "/search"
            });
          </script>
        `);
      }
      return jsonResponse([
        {
          Name: "Saturday, May 23, 2026",
          Games: [
            {
              Id: 40477691,
              VenueName: "Reno-Sparks Convention Center",
              CourtName: "Court CC1",
              AwayDivisionTeamId: 5168259,
              HomeDivisionTeamId: 5104214,
              GameTypeName: "Pool C",
              HomeTeamName: "CV Hornets Conner",
              AwayTeamName: "Splash City",
              DivisionName: "Boys 2nd/3rd Level 3 Blue",
              DivisionId: 1278469,
              DateFormatted: "5/23/2099",
              TimeFormatted: "7:00 PM PDT",
              HomeTeamScoreDisplay: "",
              AwayTeamScoreDisplay: "",
              Started: false,
            },
            {
              Id: 40477620,
              VenueName: "Reno-Sparks Convention Center",
              CourtName: "Court CC34",
              GameTypeName: "Championship (G3)",
              HomeTeamName: "W2 (Championship)",
              AwayTeamName: "W1 (Championship)",
              DivisionName: "Boys 2nd/3rd Level 3 Blue",
              DivisionId: 1278469,
              DateFormatted: "5/25/2099",
              TimeFormatted: "4:30 PM PDT",
              HomeTeamScoreDisplay: "42",
              AwayTeamScoreDisplay: "38",
              HomeTeamIsWinner: true,
            },
          ],
        },
      ]);
    }) as unknown as typeof fetch;

    const games = await new PublicExposurePageClient({
      baseUrl: "https://basketball.exposureevents.com",
      fetchImpl,
    }).fetchGames(255539, {
      divisionIds: ["1278469"],
    });

    expect(games[0]).toMatchObject({
      exposureGameId: "40477691",
      courtName: "Court CC1",
      homeTeamId: "public-team-255539-5104214",
      awayTeamId: "public-team-255539-5168259",
      homeScore: null,
      awayScore: null,
      status: "upcoming",
    });
    expect(games[1]).toMatchObject({
      courtName: "Court CC34",
      homeScore: 42,
      awayScore: 38,
      status: "final",
    });
    expect((games[1]?.rawJson as { BracketUrl?: string }).BracketUrl).toBe(
      "https://basketball.exposureevents.com/255539/2026-reno-memorial-day-tournament/bracket/784213",
    );
    expect(
      (games[0]?.rawJson as { DivisionBracketUrls?: Array<{ url: string }> })
        .DivisionBracketUrls?.[0]?.url,
    ).toBe(
      "https://basketball.exposureevents.com/255539/2026-reno-memorial-day-tournament/bracket/784213",
    );
  });

  it("reads official placement rows from primary bracket pages", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/schedule")) {
        return htmlResponse(`
          <script>
            app.viewModel.schedule.init({
              divisions: [{"Id":1278429,"Name":"Boys 5th Level 3 Blue"}],
              brackets: [
                {"Id":783010,"Name":"Gold","DivisionId":1278429,"CrossDivisionIds":[],"ShowStandings":false},
                {"Id":783012,"Name":"Silver","DivisionId":1278429,"CrossDivisionIds":[],"ShowStandings":false}
              ],
              searchUrl: "/search"
            });
          </script>
        `);
      }
      if (url.includes("/bracket/783010")) {
        return htmlResponse(`
          <div class="bracket-winner">
            <div class="winner-source"><span class="name"><a href="/255539/2026-reno-memorial-day-tournament/teams/trust-basketball?divisionteamid=5097040">TRUST BASKETBALL</a></span></div>
            <div>1st Place</div>
          </div>
          <div class="bracket-winner">
            <div class="winner-source"><span class="name"><a href="/255539/2026-reno-memorial-day-tournament/teams/hui-basketball-club?divisionteamid=5109798">HUI Basketball Club</a></span></div>
            <div>2nd Place</div>
          </div>
          <div class="bracket-winner">
            <div class="winner-source"><span class="name"><a href="/255539/2026-reno-memorial-day-tournament/teams/utah-titans-5?divisionteamid=5026411">Utah Titans 5</a></span></div>
            <div>3rd Place</div>
          </div>
        `);
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as unknown as typeof fetch;

    const results = await new PublicExposurePageClient({
      baseUrl: "https://basketball.exposureevents.com",
      fetchImpl,
    }).fetchDivisionResults(255539);

    expect(
      results.map((result) => [
        result.placement,
        result.teamId,
        result.teamNameSnapshot,
        result.teamSourceUrl,
      ]),
    ).toEqual([
      [
        1,
        "public-team-255539-5097040",
        "TRUST BASKETBALL",
        "https://basketball.exposureevents.com/255539/2026-reno-memorial-day-tournament/teams/trust-basketball?divisionteamid=5097040",
      ],
      [
        2,
        "public-team-255539-5109798",
        "HUI Basketball Club",
        "https://basketball.exposureevents.com/255539/2026-reno-memorial-day-tournament/teams/hui-basketball-club?divisionteamid=5109798",
      ],
      [
        3,
        "public-team-255539-5026411",
        "Utah Titans 5",
        "https://basketball.exposureevents.com/255539/2026-reno-memorial-day-tournament/teams/utah-titans-5?divisionteamid=5026411",
      ],
    ]);
    expect(results[0]).toMatchObject({
      divisionId: "division-255539-1278429",
      divisionName: "Boys 5th Level 3 Blue",
      medalLabel: "Gold",
      bracketLabel: "Gold",
      isOfficial: true,
    });
    expect(fetchImpl).not.toHaveBeenCalledWith(
      expect.stringContaining("/bracket/783012"),
      expect.anything(),
    );
  });

  it("uses completed playoff bracket champion pages when tournaments do not label brackets Gold", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/schedule")) {
        return htmlResponse(`
          <script>
            app.viewModel.schedule.init({
              divisions: [{"Id":1430131,"Name":"16U EAST"}],
              brackets: [
                {"Id":794194,"Name":"Playoffs","DivisionId":1430131,"CrossDivisionIds":[],"ShowStandings":false},
                {"Id":794195,"Name":"Consolation Games","DivisionId":1430131,"CrossDivisionIds":[],"ShowStandings":false}
              ],
              searchUrl: "/search"
            });
          </script>
        `);
      }
      if (url.includes("/bracket/794194")) {
        return htmlResponse(`
          <div class="bracket-winner" style="left: 300px; top: 279px;">
            <div class="winner-source"><span class="name"><a href="/252014/g365-memorial-day-challenge/teams/ema-leaders-16u-blue?divisionteamid=5302051">EMA L.E.A.D.E.R.S. 16u Blue</a></span></div>
            <div>Champion</div>
          </div>
          <div class="bracket-part" style="left: 150px; top: 231px;">
            <div class="clearfix away-team bracket-team">
              <div class="participant"><span class="name"><a href="/252014/g365-memorial-day-challenge/teams/ema-leaders-16u-blue?divisionteamid=5302051">EMA L.E.A.D.E.R.S. 16u Blue</a></span>(74)</div>
            </div>
            <div class="game-number-wrapper"><div class="game-number"><div class="number">3</div></div></div>
            <div class="clearfix home-team bracket-team">
              <div class="participant"><span class="name"><a href="/252014/g365-memorial-day-challenge/teams/all-in-premier?divisionteamid=5302053">All-In Premier</a></span>(37)</div>
            </div>
          </div>
        `);
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as unknown as typeof fetch;

    const results = await new PublicExposurePageClient({
      baseUrl: "https://basketball.exposureevents.com",
      fetchImpl,
    }).fetchDivisionResults(252014, {
      eventSlug: "g365-memorial-day-challenge",
    });

    expect(
      results.map((result) => [
        result.placement,
        result.teamNameSnapshot,
        result.source,
        result.bracketLabel,
      ]),
    ).toEqual([
      [1, "EMA L.E.A.D.E.R.S. 16u Blue", "bracket_final", "Playoffs"],
      [2, "All-In Premier", "bracket_final", "Playoffs"],
    ]);
    expect(fetchImpl).not.toHaveBeenCalledWith(
      expect.stringContaining("/bracket/794195"),
      expect.anything(),
    );
  });

  it("uses completed division standings when a division has no primary bracket", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/schedule")) {
        return htmlResponse(`
          <script>
            app.viewModel.schedule.init({
              divisions: [{"Id":1425898,"Name":"Boys 2nd/3rd Level 3 Red"}],
              brackets: [],
              standingsUrl: "/255539/2026-reno-memorial-day-tournament/standings?eventid=255539",
              searchUrl: "/search"
            });
          </script>
        `);
      }
      if (url.includes("/standings")) {
        return jsonResponse([
          {
            PoolName: "A",
            Teams: [
              {
                Name: "REIGN CITY",
                TeamLink:
                  "/255539/2026-reno-memorial-day-tournament/teams/reign-city?divisionteamid=5106272",
                Place: "1st",
                Complete: true,
                Wins: 4,
                Losses: 0,
              },
              {
                Name: "Olympic Club (Ian)",
                TeamLink:
                  "/255539/2026-reno-memorial-day-tournament/teams/olympic-club-ian?divisionteamid=5129757",
                Place: "2nd",
                Complete: true,
                Wins: 2,
                Losses: 2,
              },
              {
                Name: "NorCal Elite - White",
                TeamLink:
                  "/255539/2026-reno-memorial-day-tournament/teams/norcal-elite-white?divisionteamid=5106274",
                Place: "3rd",
                Complete: true,
                Wins: 2,
                Losses: 2,
              },
            ],
          },
        ]);
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as unknown as typeof fetch;

    const results = await new PublicExposurePageClient({
      baseUrl: "https://basketball.exposureevents.com",
      fetchImpl,
    }).fetchDivisionResults(255539);

    expect(
      results.map((result) => [
        result.placement,
        result.teamNameSnapshot,
        result.source,
        result.bracketLabel,
      ]),
    ).toEqual([
      [1, "REIGN CITY", "official_standings", "Standings"],
      [2, "Olympic Club (Ian)", "official_standings", "Standings"],
      [3, "NorCal Elite - White", "official_standings", "Standings"],
    ]);
    expect(results[0]?.rawJson).toMatchObject({
      OfficialPlacement: true,
      Wins: 4,
      Losses: 0,
    });
  });
});
