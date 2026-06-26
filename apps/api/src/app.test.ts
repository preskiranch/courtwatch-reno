import { describe, expect, it } from "vitest";
import request from "supertest";
import { normalizeName, seedGames, seedSnapshot } from "@courtwatch/core";
import type { Game } from "@courtwatch/core";
import { createApp } from "./app.js";
import { MockStore } from "./store.js";

describe("CourtWatch API", () => {
  it("returns a dashboard response", async () => {
    const app = createApp(new MockStore(), null);
    const response = await request(app).get("/api/dashboard").expect(200);
    expect(response.body.event.exposureEventId).toBe(255539);
    expect(response.body.events[0].exposureEventId).toBe(255539);
    expect(response.body.programs).toHaveLength(1);
    expect(response.body.programs[0].teams).toHaveLength(0);
  });

  it("returns public registered and follower stats", async () => {
    const app = createApp(new MockStore(), null);
    const response = await request(app).get("/api/accounts/stats").expect(200);
    expect(response.body).toMatchObject({
      registeredUsers: 0,
      unregisteredFollowerDevices: 0,
      totalFollowerUsers: 0,
    });
  });

  it("does not mark events tracked until the current device follows a team", async () => {
    const app = createApp(new MockStore(), null);
    const response = await request(app).get("/api/events").expect(200);
    expect(response.body[0]).toMatchObject({
      exposureEventId: 255539,
      dropdownGroup: "upcoming",
      hasPublicTeamList: true,
      registeredTeamCount: seedSnapshot.teams.length,
    });
  });

  it("marks events tracked for the device that follows a team in them", async () => {
    const app = createApp(new MockStore(), null);
    await request(app)
      .post("/api/teams/team-splash-4th/follow")
      .set("x-courtwatch-client-id", "client-alpha-123")
      .expect(201);

    const alpha = await request(app)
      .get("/api/events")
      .set("x-courtwatch-client-id", "client-alpha-123")
      .expect(200);
    const beta = await request(app)
      .get("/api/events")
      .set("x-courtwatch-client-id", "client-beta-456")
      .expect(200);

    expect(alpha.body[0].dropdownGroup).toBe("tracked");
    expect(beta.body[0].dropdownGroup).toBe("upcoming");
  });

  it("returns an all-tournament sync fingerprint for realtime refresh", async () => {
    const app = createApp(new MockStore(), null);
    const response = await request(app)
      .get("/api/sync-status?scope=all")
      .expect(200);
    expect(response.body).toMatchObject({
      scope: "all",
      exposureEventId: null,
    });
    expect(response.body.fingerprint).toContain("all|");
  });

  it("lets a user follow and unfollow a selected team", async () => {
    const app = createApp(new MockStore(), null);
    await request(app).post("/api/teams/team-splash-4th/follow").expect(201);
    const followed = await request(app).get("/api/dashboard").expect(200);
    expect(
      followed.body.programs[0].teams.map((team: { id: string }) => team.id),
    ).toContain("team-splash-4th");
    await request(app).delete("/api/teams/team-splash-4th/follow").expect(204);
    const unfollowed = await request(app).get("/api/dashboard").expect(200);
    expect(unfollowed.body.programs[0].teams).toHaveLength(0);
  });

  it("keeps favorite team watches separate by browser client id", async () => {
    const app = createApp(new MockStore(), null);

    await request(app)
      .post("/api/favorite-team-watches")
      .set("x-courtwatch-client-id", "client-alpha-123")
      .send({ displayName: "Splash City Future 12U" })
      .expect(201);

    const alpha = await request(app)
      .get("/api/favorite-team-watches")
      .set("x-courtwatch-client-id", "client-alpha-123")
      .expect(200);
    const beta = await request(app)
      .get("/api/favorite-team-watches")
      .set("x-courtwatch-client-id", "client-beta-456")
      .expect(200);

    expect(alpha.body).toHaveLength(1);
    expect(alpha.body[0]).toMatchObject({
      displayName: "Splash City Future 12U",
      source: "custom",
      sourceTeamId: null,
    });
    expect(beta.body).toHaveLength(0);

    await request(app)
      .delete(`/api/favorite-team-watches/${alpha.body[0].id}`)
      .set("x-courtwatch-client-id", "client-alpha-123")
      .expect(204);

    const alphaAfterDelete = await request(app)
      .get("/api/favorite-team-watches")
      .set("x-courtwatch-client-id", "client-alpha-123")
      .expect(200);
    expect(alphaAfterDelete.body).toHaveLength(0);
  });

  it("keeps followed teams separate by browser client id", async () => {
    const app = createApp(new MockStore(), null);

    await request(app)
      .post("/api/teams/team-splash-4th/follow")
      .set("x-courtwatch-client-id", "client-alpha-123")
      .expect(201);

    const alpha = await request(app)
      .get("/api/dashboard")
      .set("x-courtwatch-client-id", "client-alpha-123")
      .expect(200);
    const beta = await request(app)
      .get("/api/dashboard")
      .set("x-courtwatch-client-id", "client-beta-456")
      .expect(200);

    expect(
      alpha.body.programs[0].teams.map((team: { id: string }) => team.id),
    ).toEqual(["team-splash-4th"]);
    expect(beta.body.programs[0].teams).toHaveLength(0);

    await request(app)
      .post("/api/teams/team-splash-6th/follow")
      .set("x-courtwatch-client-id", "client-beta-456")
      .expect(201);

    const alphaAfterBetaFollow = await request(app)
      .get("/api/dashboard")
      .set("x-courtwatch-client-id", "client-alpha-123")
      .expect(200);
    expect(
      alphaAfterBetaFollow.body.programs[0].teams.map(
        (team: { id: string }) => team.id,
      ),
    ).toEqual(["team-splash-4th"]);
  });

  it("returns anonymous follower counts for teams that are already followed", async () => {
    const app = createApp(new MockStore(), null);

    await request(app)
      .post("/api/teams/team-splash-4th/follow")
      .set("x-courtwatch-client-id", "client-alpha-123")
      .expect(201);
    await request(app)
      .post("/api/teams/team-splash-4th/follow")
      .set("x-courtwatch-client-id", "client-beta-456")
      .expect(201);

    const teams = await request(app)
      .get("/api/teams?search=Splash")
      .set("x-courtwatch-client-id", "client-alpha-123")
      .expect(200);
    const splash4 = teams.body.find(
      (team: { id: string }) => team.id === "team-splash-4th",
    );
    expect(splash4.followerCount).toBe(2);
    expect(splash4.isFollowed).toBe(true);

    const dashboard = await request(app)
      .get("/api/dashboard")
      .set("x-courtwatch-client-id", "client-alpha-123")
      .expect(200);
    expect(dashboard.body.programs[0].teams[0].followerCount).toBe(2);

    const guestTeams = await request(app)
      .get("/api/teams?search=Splash")
      .set("x-courtwatch-client-id", "client-gamma-789")
      .expect(200);
    const splash4Guest = guestTeams.body.find(
      (team: { id: string }) => team.id === "team-splash-4th",
    );
    expect(splash4Guest.followerCount).toBe(2);
    expect(splash4Guest.isFollowed).toBe(false);
  });

  it("does not carry a followed team into another tournament with the same team name", async () => {
    const snapshot = structuredClone(seedSnapshot);
    const now = new Date().toISOString();
    const secondEvent = {
      ...snapshot.event,
      id: "event-yellow-jacket-summerfest",
      exposureEventId: 991001,
      externalId: "991001",
      slug: "yellow-jacket-summerfest",
      sourceUrl:
        "https://basketball.exposureevents.com/991001/yellow-jacket-summerfest",
      name: "Yellow Jacket Summerfest",
      organizer: "Sacramento Yellow Jackets",
      city: "Sacramento",
      state: "California",
      region: "Northern California",
      startDate: "2026-06-27",
      endDate: "2026-06-27",
      location: "Sacramento, California",
      officialUrl:
        "https://basketball.exposureevents.com/991001/yellow-jacket-summerfest",
      registeredTeamCount: 1,
      lastCheckedAt: now,
      lastSyncedAt: now,
      lastTeamChangeAt: now,
      status: "upcoming" as const,
      dropdownGroup: "upcoming" as const,
    };
    const secondDivision = {
      ...snapshot.divisions[0]!,
      id: "division-yellow-jacket-9u",
      eventId: secondEvent.id,
      exposureDivisionId: "yellow-jacket-9u",
      name: "9U",
      gradeLevel: "9U",
      level: "Level TBD",
    };
    const secondTeam = {
      ...snapshot.teams[0]!,
      id: "team-yellow-jacket-splash-city-9u",
      eventId: secondEvent.id,
      divisionId: secondDivision.id,
      exposureTeamId: "yellow-jacket-splash-city-9u",
      name: "Splash City 9U",
      normalizedName: normalizeName("Splash City 9U"),
      clubName: "Splash City",
      normalizedClubName: normalizeName("Splash City"),
      sourceUrl:
        "https://basketball.exposureevents.com/991001/yellow-jacket-summerfest/teams/splash-city-9u",
      divisionName: secondDivision.name,
      gradeLevel: secondDivision.gradeLevel,
      level: secondDivision.level,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
      exposureEventId: secondEvent.exposureEventId,
      eventName: secondEvent.name,
      eventLocation: secondEvent.location,
      isFollowed: false,
      followerCount: 0,
      record: undefined,
    };

    snapshot.events = [snapshot.event, secondEvent];
    snapshot.divisions = [...snapshot.divisions, secondDivision];
    snapshot.teams = [...snapshot.teams, secondTeam];

    const app = createApp(new MockStore(snapshot), null);
    await request(app)
      .post("/api/teams/team-splash-4th/follow")
      .set("x-courtwatch-client-id", "client-alpha-123")
      .expect(201);

    const renoTeams = await request(app)
      .get("/api/teams?search=Splash&eventId=255539")
      .set("x-courtwatch-client-id", "client-alpha-123")
      .expect(200);
    const renoSplash = renoTeams.body.find(
      (team: { id: string }) => team.id === "team-splash-4th",
    );
    expect(renoSplash.isFollowed).toBe(true);

    const yellowJacketTeams = await request(app)
      .get("/api/teams?search=Splash&eventId=991001")
      .set("x-courtwatch-client-id", "client-alpha-123")
      .expect(200);
    expect(yellowJacketTeams.body).toHaveLength(1);
    expect(yellowJacketTeams.body[0]).toMatchObject({
      id: "team-yellow-jacket-splash-city-9u",
      name: "Splash City 9U",
      isFollowed: false,
      followerCount: 0,
    });
  });

  it("searches registered teams without using player names", async () => {
    const snapshot = structuredClone(seedSnapshot);
    snapshot.players = [
      {
        id: "player-test-1",
        eventId: snapshot.event.id,
        teamId: "team-splash-4th",
        exposurePlayerId: "test-1",
        firstName: "Jordan",
        lastName: "Sample",
        fullName: "Jordan Sample",
        normalizedName: normalizeName("Jordan Sample"),
        jerseyNumber: "12",
        position: "G",
        grade: "4th",
        rawJson: {},
        lastSeenAt: new Date().toISOString(),
      },
    ];
    const app = createApp(new MockStore(snapshot), null);
    const response = await request(app)
      .get("/api/teams?search=Jordan")
      .expect(200);
    expect(response.body).toHaveLength(0);
  });

  it("sorts registered teams alphabetically while keeping duplicate team names together", async () => {
    const snapshot = structuredClone(seedSnapshot);
    const ids = [
      "team-splash-6th",
      "team-premier-10u",
      "team-splash-4th",
      "team-norcal-6",
      "team-splash-3rd",
      "team-arsenal-boys-8",
    ];
    snapshot.teams = ids.map((id) => {
      const team = seedSnapshot.teams.find((item) => item.id === id);
      if (!team) throw new Error(`Missing seed team ${id}`);
      return team;
    });
    const app = createApp(new MockStore(snapshot), null);
    const response = await request(app).get("/api/teams").expect(200);
    expect(response.body.map((team: { id: string }) => team.id)).toEqual([
      "team-norcal-6",
      "team-premier-10u",
      "team-splash-3rd",
      "team-splash-4th",
      "team-splash-6th",
      "team-arsenal-boys-8",
    ]);
  });

  it("returns server-computed points leaders for the selected tournament", async () => {
    const app = createApp(new MockStore(), null);
    const response = await request(app)
      .get("/api/points-leaders")
      .set("x-courtwatch-client-id", "client-points-123")
      .expect(200);
    expect(response.body.length).toBe(seedSnapshot.teams.length);
    expect(response.body[0]).toMatchObject({
      teamName: expect.any(String),
      totalPoints: expect.any(Number),
      wins: expect.any(Number),
      losses: expect.any(Number),
    });
  });

  it("returns court finder summaries with live and up-next games", async () => {
    const snapshot = structuredClone(seedSnapshot);
    const now = Date.now();
    const baseGame = seedGames[0]!;
    snapshot.games = [
      {
        ...baseGame,
        id: "game-court-34-final",
        exposureGameId: "game-court-34-final",
        homeTeamId: "team-splash-4th",
        awayTeamId: "team-premier-10u",
        homeTeamNameSnapshot: "Splash City 10U",
        awayTeamNameSnapshot: "Premier 10U Gold",
        homeScore: 42,
        awayScore: 38,
        status: "final",
        startsAt: new Date(now - 2 * 60 * 60_000).toISOString(),
        scheduledDate: "2026-06-02",
        scheduledTime: "10:00 AM",
        courtName: "Court 34",
      },
      {
        ...baseGame,
        id: "game-court-34-live",
        exposureGameId: "game-court-34-live",
        homeTeamId: "team-splash-4th",
        awayTeamId: "team-premier-10u",
        homeTeamNameSnapshot: "Splash City 10U",
        awayTeamNameSnapshot: "Premier 10U Gold",
        homeScore: null,
        awayScore: null,
        status: "upcoming",
        startsAt: new Date(now - 5 * 60_000).toISOString(),
        scheduledDate: "2026-06-02",
        scheduledTime: "12:00 PM",
        courtName: "Court 34",
      },
      {
        ...baseGame,
        id: "game-court-34-next",
        exposureGameId: "game-court-34-next",
        homeTeamId: "team-splash-6th",
        awayTeamId: "team-norcal-6",
        homeTeamNameSnapshot: "Splash City 12U",
        awayTeamNameSnapshot: "NorCal Elite Blue",
        homeScore: null,
        awayScore: null,
        status: "upcoming",
        startsAt: new Date(now + 90 * 60_000).toISOString(),
        scheduledDate: "2026-06-02",
        scheduledTime: "1:30 PM",
        courtName: "Court 34",
      },
    ] satisfies Game[];
    const app = createApp(new MockStore(snapshot), null);
    const response = await request(app).get("/api/courts").expect(200);
    const court34 = response.body.find(
      (court: { courtName: string }) => court.courtName === "Court 34",
    );

    expect(court34).toMatchObject({
      courtName: "Court 34",
      venueName: "Reno-Sparks Convention Center",
      currentGames: [
        {
          game: {
            id: "game-court-34-live",
            status: "playing_now",
            homeTeamNameSnapshot: "Splash City 10U",
            awayTeamNameSnapshot: "Premier 10U Gold",
            homeTeamRecord: { wins: 1, losses: 0 },
          },
        },
      ],
      upNextGame: {
        game: {
          id: "game-court-34-next",
          homeTeamNameSnapshot: "Splash City 12U",
          awayTeamNameSnapshot: "NorCal Elite Blue",
        },
      },
    });
  });

  it("includes points leaders in the dashboard payload", async () => {
    const app = createApp(new MockStore(), null);
    const response = await request(app)
      .get("/api/dashboard")
      .set("x-courtwatch-client-id", "client-points-dashboard")
      .expect(200);
    expect(response.body.pointsLeaders.length).toBe(seedSnapshot.teams.length);
    expect(response.body.pointsLeaders[0]).toMatchObject({
      teamName: expect.any(String),
      totalPoints: expect.any(Number),
      wins: expect.any(Number),
      losses: expect.any(Number),
    });
  });

  it("returns final results without changing saved followed teams", async () => {
    const snapshot = structuredClone(seedSnapshot);
    snapshot.games = [
      {
        ...seedGames[0]!,
        id: "game-gold-final",
        exposureGameId: "game-gold-final",
        divisionId: "division-boys-4th-green",
        gameType: "Gold Championship",
        homeTeamId: "team-splash-4th",
        awayTeamId: "team-premier-10u",
        homeTeamNameSnapshot: "Splash City",
        awayTeamNameSnapshot: "Premier 10U Gold",
        homeScore: 42,
        awayScore: 38,
        status: "final",
        rawJson: {
          BracketUrl:
            "https://basketball.exposureevents.com/255539/2026-reno-memorial-day-tournament/bracket/test",
          OfficialPlacement: true,
        },
      } satisfies Game,
    ];
    const app = createApp(new MockStore(snapshot), null);

    await request(app)
      .post("/api/teams/team-splash-4th/follow")
      .set("x-courtwatch-client-id", "client-results-123")
      .expect(201);
    const results = await request(app)
      .get("/api/results")
      .set("x-courtwatch-client-id", "client-results-123")
      .expect(200);
    expect(
      results.body[0].rows.map(
        (result: { placement: number; medalLabel: string; teamId: string }) => [
          result.placement,
          result.medalLabel,
          result.teamId,
        ],
      ),
    ).toEqual([
      [1, "Gold", "team-splash-4th"],
      [2, "Silver", "team-premier-10u"],
    ]);

    const dashboard = await request(app)
      .get("/api/dashboard")
      .set("x-courtwatch-client-id", "client-results-123")
      .expect(200);
    expect(
      dashboard.body.programs[0].teams.map((team: { id: string }) => team.id),
    ).toEqual(["team-splash-4th"]);
  });

  it("keeps final-results My divisions separate by browser client id", async () => {
    const snapshot = structuredClone(seedSnapshot);
    snapshot.games = [
      {
        ...seedGames[0]!,
        id: "game-alpha-gold-final",
        exposureGameId: "game-alpha-gold-final",
        divisionId: "division-boys-4th-green",
        gameType: "Gold Championship",
        homeTeamId: "team-splash-4th",
        awayTeamId: "team-premier-10u",
        homeTeamNameSnapshot: "Splash City",
        awayTeamNameSnapshot: "Premier 10U Gold",
        homeScore: 42,
        awayScore: 38,
        status: "final",
      } satisfies Game,
      {
        ...seedGames[2]!,
        id: "game-beta-gold-final",
        exposureGameId: "game-beta-gold-final",
        divisionId: "division-boys-6th-blue",
        gameType: "Gold Championship",
        homeTeamId: "team-norcal-6",
        awayTeamId: "team-splash-6th",
        homeTeamNameSnapshot: "NorCal Elite Blue",
        awayTeamNameSnapshot: "Splash City 6th",
        homeScore: 35,
        awayScore: 28,
        status: "final",
      } satisfies Game,
    ];
    const app = createApp(new MockStore(snapshot), null);

    await request(app)
      .post("/api/teams/team-splash-4th/follow")
      .set("x-courtwatch-client-id", "client-results-alpha")
      .expect(201);
    await request(app)
      .post("/api/teams/team-splash-6th/follow")
      .set("x-courtwatch-client-id", "client-results-beta")
      .expect(201);

    const alphaResults = await request(app)
      .get("/api/results")
      .set("x-courtwatch-client-id", "client-results-alpha")
      .expect(200);
    const betaResults = await request(app)
      .get("/api/results")
      .set("x-courtwatch-client-id", "client-results-beta")
      .expect(200);

    expect(
      alphaResults.body.map(
        (group: { divisionId: string }) => group.divisionId,
      ),
    ).toEqual(["division-boys-4th-green"]);
    expect(
      betaResults.body.map((group: { divisionId: string }) => group.divisionId),
    ).toEqual(["division-boys-6th-blue"]);
  });

  it("tracks active online users with a heartbeat", async () => {
    const app = createApp(new MockStore(), null);
    const response = await request(app)
      .post("/api/presence/heartbeat")
      .send({ clientId: "test-client-1", page: "dashboard" })
      .expect(200);
    expect(response.body.activeUsers).toBeGreaterThanOrEqual(1);
    expect(response.body.pages.dashboard).toBeGreaterThanOrEqual(1);
  });

  it("protects admin sync with ADMIN_SECRET when configured", async () => {
    process.env.ADMIN_SECRET = "test-secret";
    const app = createApp(new MockStore(), null);
    await request(app).post("/api/admin/sync-now").expect(401);
    await request(app)
      .post("/api/admin/sync-now")
      .set("x-admin-secret", "test-secret")
      .expect(200);
    delete process.env.ADMIN_SECRET;
  });
});
