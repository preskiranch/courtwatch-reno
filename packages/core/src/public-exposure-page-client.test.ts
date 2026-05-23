import { describe, expect, it, vi } from "vitest";
import { PublicExposurePageClient } from "./public-exposure-page-client.js";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function htmlResponse(value: string) {
  return new Response(value, {
    status: 200,
    headers: { "Content-Type": "text/html" }
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
            Name: "Splash City (Boys 2nd/3rd Level 3 Blue)"
          }
        ],
        Players: []
      })
    ) as unknown as typeof fetch;

    const result = await new PublicExposurePageClient({ baseUrl: "https://basketball.exposureevents.com", fetchImpl }).fetchTeams(255539);

    expect(result.divisions[0]?.id).toBe("division-1278469");
    expect(result.teams[0]).toMatchObject({
      id: "public-team-5168259",
      exposureTeamId: "5168259",
      name: "Splash City",
      divisionId: "division-1278469"
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
              Started: false
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
              HomeTeamIsWinner: true
            }
          ]
        }
      ]);
    }) as unknown as typeof fetch;

    const games = await new PublicExposurePageClient({ baseUrl: "https://basketball.exposureevents.com", fetchImpl }).fetchGames(255539, {
      divisionIds: ["1278469"]
    });

    expect(games[0]).toMatchObject({
      exposureGameId: "40477691",
      courtName: "Court CC1",
      homeTeamId: "public-team-5104214",
      awayTeamId: "public-team-5168259",
      homeScore: null,
      awayScore: null,
      status: "upcoming"
    });
    expect(games[1]).toMatchObject({
      courtName: "Court CC34",
      homeScore: 42,
      awayScore: 38,
      status: "final"
    });
    expect((games[1]?.rawJson as { BracketUrl?: string }).BracketUrl).toBe("https://basketball.exposureevents.com/255539/2026-reno-memorial-day-tournament/bracket/784213");
  });
});
