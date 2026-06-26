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

  it("falls back to official team schedules when division games are not posted yet", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/schedule")) {
        return htmlResponse(`
          <script>
            app.viewModel.schedule.init({
              divisions: [{"Id":1448860,"Name":"9U, Pool A"}],
              standingsUrl: "/standings",
              brackets: [],
              searchUrl: "/search"
            });
          </script>
        `);
      }
      if (url.includes("/eventgames")) return jsonResponse([]);
      if (url.includes("/e/teamgames?divisionteamid=5412439")) {
        return jsonResponse([
          {
            Name: "Saturday, June 27, 2026",
            Games: [
              {
                Id: 40900101,
                VenueName: "Christian Brothers High School",
                CourtName: "Aux #1",
                AwayDivisionTeamId: 5412439,
                HomeDivisionTeamId: 5411916,
                GameTypeName: "Pool A",
                HomeTeamName: "Yellow Jackets 9U Gold",
                AwayTeamName: "Splash City",
                DivisionName: "9U, Pool A",
                DivisionId: 1448860,
                DateFormatted: "6/27/2099",
                TimeFormatted: "8:50 AM PDT",
                HomeTeamScoreDisplay: "",
                AwayTeamScoreDisplay: "",
                Started: false,
              },
              {
                Id: 40900102,
                VenueName: "Christian Brothers High School",
                CourtName: "Aux #1",
                AwayDivisionTeamId: 5412100,
                HomeDivisionTeamId: 5412439,
                GameTypeName: "Pool A",
                HomeTeamName: "Splash City",
                AwayTeamName: "Peaceful Warriors",
                DivisionName: "9U, Pool A",
                DivisionId: 1448860,
                DateFormatted: "6/27/2099",
                TimeFormatted: "10:30 AM PDT",
                HomeTeamScoreDisplay: "",
                AwayTeamScoreDisplay: "",
                Started: false,
              },
            ],
          },
        ]);
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as unknown as typeof fetch;

    const games = await new PublicExposurePageClient({
      baseUrl: "https://basketball.exposureevents.com",
      fetchImpl,
    }).fetchGames(256066, {
      eventSlug: "yellow-jackets-summerfest",
      teamIds: ["5412439"],
      timezone: "America/Los_Angeles",
    });

    expect(games).toHaveLength(2);
    expect(games[0]).toMatchObject({
      exposureGameId: "40900101",
      scheduledTime: "8:50 AM",
      courtName: "Aux #1",
      homeTeamId: "public-team-256066-5411916",
      awayTeamId: "public-team-256066-5412439",
      homeTeamNameSnapshot: "Yellow Jackets 9U Gold",
      awayTeamNameSnapshot: "Splash City",
      status: "upcoming",
    });
    expect(games[1]).toMatchObject({
      scheduledTime: "10:30 AM",
      homeTeamNameSnapshot: "Splash City",
      awayTeamNameSnapshot: "Peaceful Warriors",
    });
  });

  it("expires old public started games when Exposure never posts a score", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/schedule")) {
        return htmlResponse(`
          <script>
            app.viewModel.schedule.init({
              divisions: [{"Id":1278469,"Name":"Boys 2nd/3rd Level 3 Blue"}],
              standingsUrl: "/standings",
              brackets: [],
              searchUrl: "/search"
            });
          </script>
        `);
      }
      return jsonResponse([
        {
          Name: "Wednesday, January 1, 2020",
          Games: [
            {
              Id: 40477691,
              VenueName: "Reno-Sparks Convention Center",
              CourtName: "Court CC1",
              HomeTeamName: "CV Hornets Conner",
              AwayTeamName: "Splash City",
              DivisionName: "Boys 2nd/3rd Level 3 Blue",
              DivisionId: 1278469,
              DateFormatted: "1/1/2020",
              TimeFormatted: "10:00 AM PST",
              HomeTeamScoreDisplay: "",
              AwayTeamScoreDisplay: "",
              Started: true,
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

    expect(games[0]?.status).toBe("unknown");
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
      if (url.includes("/standings")) {
        return jsonResponse([]);
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

  it("does not use standings as final placements while a result bracket is unresolved", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/schedule")) {
        return htmlResponse(`
          <script>
            app.viewModel.schedule.init({
              divisions: [{"Id":1433824,"Name":"10U/11U 4th/5th Grade"}],
              brackets: [
                {"Id":799408,"Name":"Championship","DivisionId":1433824,"CrossDivisionIds":[],"ShowStandings":false}
              ],
              searchUrl: "/search"
            });
          </script>
        `);
      }
      if (url.includes("/bracket/799408")) {
        return htmlResponse(`
          <div class="bracket-winner" style="left: 300px; top: 279px;">
            <div class="winner-source"><span class="name">W1</span></div>
            <div>Champion</div>
          </div>
        `);
      }
      if (url.includes("/standings")) {
        return jsonResponse([
          {
            PoolName: "A",
            Teams: [
              {
                Name: "TXHE J3SSB 2033",
                TeamLink:
                  "/252017/g365-kings-of-the-south/teams/txhe-j3ssb-2033?divisionteamid=5330644",
                Place: "1st",
                Wins: 3,
                Losses: 0,
                Complete: true,
              },
              {
                Name: "AB Elite 2034",
                TeamLink:
                  "/252017/g365-kings-of-the-south/teams/ab-elite-2034?divisionteamid=5330643",
                Place: "2nd",
                Wins: 2,
                Losses: 1,
                Complete: true,
              },
              {
                Name: "Hard Hoops 2033 Jr 3SSB",
                TeamLink:
                  "/252017/g365-kings-of-the-south/teams/hard-hoops-2033-jr-3ssb?divisionteamid=5330642",
                Place: "3rd",
                Wins: 1,
                Losses: 2,
                Complete: true,
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
    }).fetchDivisionResults(252017, {
      eventSlug: "g365-kings-of-the-south",
    });

    expect(results).toEqual([]);
  });

  it("keeps two-day playoff divisions pending until the championship bracket is complete", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/schedule")) {
        return htmlResponse(`
          <script>
            app.viewModel.schedule.init({
              divisions: [{"Id":1330544,"Name":"13u Division 2"}],
              brackets: [
                {"Id":802912,"Name":"Championship Playoff","DivisionId":1330544,"CrossDivisionIds":[],"ShowStandings":false},
                {"Id":802915,"Name":"Sunday Games","DivisionId":1330544,"CrossDivisionIds":[],"ShowStandings":false}
              ],
              searchUrl: "/search"
            });
          </script>
        `);
      }
      if (url.includes("/bracket/802912")) {
        return htmlResponse(`
          <div class="bracket-winner" style="left: 301px; top: 271px;">
            <div class="winner-source">
              <div class="select-container"><span class="name"></span></div>
            </div>
            <div>Champion</div>
          </div>
          <div class="bracket-part" style="left: 0px; top: 279px;">
            <div class="clearfix away-team bracket-team">
              <div class="participant"><span class="name"><a href="/261079/battle-in-the-bay/teams/nbc-bulls?divisionteamid=5351244">NBC Bulls</a></span></div>
            </div>
            <div class="game-details"><div>Sun. Jun 7 8:30 AM</div></div>
            <div class="game-number-wrapper"><div class="game-number"><div class="number">1</div></div></div>
            <div class="clearfix home-team bracket-team">
              <div class="participant"><span class="name"><a href="/261079/battle-in-the-bay/teams/sv-soldiers-12u-elite?divisionteamid=5351242">SV Soldiers 12u Elite</a></span></div>
            </div>
          </div>
          <div class="bracket-part" style="left: 151px; top: 227px;">
            <div class="clearfix away-team bracket-team">
              <div class="participant"><span class="name"><a href="/261079/battle-in-the-bay/teams/lakeshow-sun?divisionteamid=5351241">Lakeshow-Sun</a></span></div>
            </div>
            <div class="game-details"><div>Sun. Jun 7 10:20 AM</div></div>
            <div class="game-number-wrapper"><div class="game-number"><div class="number">2</div></div></div>
            <div class="clearfix home-team bracket-team">
              <div class="participant"><span class="name"></span></div>
            </div>
          </div>
        `);
      }
      if (url.includes("/standings")) {
        return jsonResponse([
          {
            PoolName: "A",
            Teams: [
              {
                Name: "Lakeshow-Sun",
                TeamLink:
                  "/261079/battle-in-the-bay/teams/lakeshow-sun?divisionteamid=5351241",
                Place: "1st",
                Wins: 2,
                Losses: 0,
                Complete: true,
              },
              {
                Name: "NBC Bulls",
                TeamLink:
                  "/261079/battle-in-the-bay/teams/nbc-bulls?divisionteamid=5351244",
                Place: "2nd",
                Wins: 2,
                Losses: 0,
                Complete: true,
              },
              {
                Name: "SV Soldiers 12u Elite",
                TeamLink:
                  "/261079/battle-in-the-bay/teams/sv-soldiers-12u-elite?divisionteamid=5351242",
                Place: "3rd",
                Wins: 1,
                Losses: 1,
                Complete: true,
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
    }).fetchDivisionResults(261079, {
      eventSlug: "battle-in-the-bay",
    });

    expect(results).toEqual([]);
  });

  it("fills bronze from completed standings when playoff standings match the bracket finalists", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/schedule")) {
        return htmlResponse(`
          <script>
            app.viewModel.schedule.init({
              divisions: [{"Id":1430119,"Name":"9U/3rd Grade"}],
              brackets: [
                {"Id":795250,"Name":"Playoffs","DivisionId":1430119,"CrossDivisionIds":[],"ShowStandings":false}
              ],
              searchUrl: "/search"
            });
          </script>
        `);
      }
      if (url.includes("/bracket/795250")) {
        return htmlResponse(`
          <div class="bracket-winner" style="left: 300px; top: 279px;">
            <div class="winner-source"><span class="name"><a href="/252014/g365-memorial-day-challenge/teams/paytons-place-elite?divisionteamid=5301985">Payton's Place Elite</a></span></div>
            <div>Champion</div>
          </div>
          <div class="bracket-part" style="left: 305px; top: 198px;">
            <div class="clearfix away-team bracket-team">
              <div class="participant"><span class="name"><a href="/252014/g365-memorial-day-challenge/teams/lakeshow-elite?divisionteamid=5301984">Lakeshow Elite</a></span>(23)</div>
            </div>
            <div class="game-number-wrapper"><div class="game-number"><div class="number">3</div></div></div>
            <div class="clearfix home-team bracket-team">
              <div class="participant"><span class="name"><a href="/252014/g365-memorial-day-challenge/teams/paytons-place-elite?divisionteamid=5301985">Payton's Place Elite</a></span>(37)</div>
            </div>
          </div>
        `);
      }
      if (url.includes("/standings")) {
        return jsonResponse([
          {
            PoolName: "A",
            Teams: [
              {
                Name: "Payton's Place Elite",
                TeamLink:
                  "/252014/g365-memorial-day-challenge/teams/paytons-place-elite?divisionteamid=5301985",
                Place: "1st",
                Wins: 2,
                Losses: 0,
                Complete: true,
              },
              {
                Name: "Lakeshow Elite",
                TeamLink:
                  "/252014/g365-memorial-day-challenge/teams/lakeshow-elite?divisionteamid=5301984",
                Place: "2nd",
                Wins: 1,
                Losses: 1,
                Complete: true,
              },
              {
                Name: "San Jose Spartans",
                TeamLink:
                  "/252014/g365-memorial-day-challenge/teams/san-jose-spartans?divisionteamid=5301983",
                Place: "3rd",
                Wins: 0,
                Losses: 2,
                Complete: true,
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
      [1, "Payton's Place Elite", "bracket_final", "Playoffs"],
      [2, "Lakeshow Elite", "bracket_final", "Playoffs"],
      [3, "San Jose Spartans", "official_standings", "Standings"],
    ]);
  });

  it("infers bronze from the completed playoff path when no explicit third-place label is posted", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/schedule")) {
        return htmlResponse(`
          <script>
            app.viewModel.schedule.init({
              divisions: [{"Id":1430131,"Name":"16U EAST"}],
              brackets: [
                {"Id":794194,"Name":"Playoffs","DivisionId":1430131,"CrossDivisionIds":[],"ShowStandings":false}
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
          <div class="bracket-part" style="left: 0px; top: 205px;">
            <div class="clearfix away-team bracket-team">
              <div class="participant"><span class="name"><a href="/252014/g365-memorial-day-challenge/teams/mavericks-aau?divisionteamid=5302055">Mavericks AAU</a></span>(48)</div>
            </div>
            <div class="game-number-wrapper"><div class="game-number"><div class="number">1</div></div></div>
            <div class="clearfix home-team bracket-team">
              <div class="participant"><span class="name"><a href="/252014/g365-memorial-day-challenge/teams/ema-leaders-16u-blue?divisionteamid=5302051">EMA L.E.A.D.E.R.S. 16u Blue</a></span>(51)</div>
            </div>
          </div>
          <div class="bracket-part" style="left: 0px; top: 285px;">
            <div class="clearfix away-team bracket-team">
              <div class="participant"><span class="name"><a href="/252014/g365-memorial-day-challenge/teams/248-elite-academy?divisionteamid=5302052">24/8 Elite Academy</a></span>(0)</div>
            </div>
            <div class="game-number-wrapper"><div class="game-number"><div class="number">2</div></div></div>
            <div class="clearfix home-team bracket-team">
              <div class="participant"><span class="name"><a href="/252014/g365-memorial-day-challenge/teams/all-in-premier?divisionteamid=5302053">All-In Premier</a></span>(15)</div>
            </div>
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
      [3, "Mavericks AAU", "bracket_final", "Playoffs"],
    ]);
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

  it("keeps official placements for each completed standings pool", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/schedule")) {
        return htmlResponse(`
          <script>
            app.viewModel.schedule.init({
              divisions: [{"Id":1366269,"Name":"9th Grade (15U) Boys Division"}],
              brackets: [],
              standingsUrl: "/264312/bam-x-gsg-spring-finale/standings?eventid=264312",
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
                Name: "PMA Knights Red 15U",
                TeamLink:
                  "/264312/bam-x-gsg-spring-finale/teams/pma-knights-red-15u?divisionteamid=5331514",
                Place: "1st",
                Complete: true,
                Wins: 2,
                Losses: 0,
              },
              {
                Name: "A.T.R. Elite 15U",
                TeamLink:
                  "/264312/bam-x-gsg-spring-finale/teams/atr-elite-15u?divisionteamid=5331515",
                Place: "2nd",
                Complete: true,
                Wins: 1,
                Losses: 1,
              },
              {
                Name: "JavStep 15U",
                TeamLink:
                  "/264312/bam-x-gsg-spring-finale/teams/javstep-15u?divisionteamid=5331516",
                Place: "3rd",
                Complete: true,
                Wins: 0,
                Losses: 2,
              },
            ],
          },
          {
            PoolName: "B",
            Teams: [
              {
                Name: "Bay Area Thunder 15U",
                TeamLink:
                  "/264312/bam-x-gsg-spring-finale/teams/bay-area-thunder-15u?divisionteamid=5331517",
                Place: "1st",
                Complete: true,
                Wins: 2,
                Losses: 0,
              },
              {
                Name: "Top Performance A 14U",
                TeamLink:
                  "/264312/bam-x-gsg-spring-finale/teams/top-performance-a-14u?divisionteamid=5331518",
                Place: "2nd",
                Complete: true,
                Wins: 1,
                Losses: 1,
              },
              {
                Name: "Ballerz United 15U",
                TeamLink:
                  "/264312/bam-x-gsg-spring-finale/teams/ballerz-united-15u?divisionteamid=5331519",
                Place: "3rd",
                Complete: true,
                Wins: 1,
                Losses: 1,
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
    }).fetchDivisionResults(264312, { eventSlug: "bam-x-gsg-spring-finale" });

    expect(
      results.map((result) => [
        result.divisionName,
        result.placement,
        result.teamNameSnapshot,
        result.bracketLabel,
      ]),
    ).toEqual([
      [
        "9th Grade (15U) Boys Division - Pool A",
        1,
        "PMA Knights Red 15U",
        "Pool A standings",
      ],
      [
        "9th Grade (15U) Boys Division - Pool A",
        2,
        "A.T.R. Elite 15U",
        "Pool A standings",
      ],
      [
        "9th Grade (15U) Boys Division - Pool A",
        3,
        "JavStep 15U",
        "Pool A standings",
      ],
      [
        "9th Grade (15U) Boys Division - Pool B",
        1,
        "Bay Area Thunder 15U",
        "Pool B standings",
      ],
      [
        "9th Grade (15U) Boys Division - Pool B",
        2,
        "Top Performance A 14U",
        "Pool B standings",
      ],
      [
        "9th Grade (15U) Boys Division - Pool B",
        3,
        "Ballerz United 15U",
        "Pool B standings",
      ],
    ]);
    expect(results[0]?.rawJson).toMatchObject({
      PoolName: "A",
      PoolKey: "a",
      SyntheticDivisionName: "9th Grade (15U) Boys Division - Pool A",
    });
  });
});
