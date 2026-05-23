import { describe, expect, it } from "vitest";
import request from "supertest";
import { normalizeName, seedSnapshot } from "@courtwatch/core";
import { createApp } from "./app.js";
import { MockStore } from "./store.js";

describe("CourtWatch API", () => {
  it("returns a dashboard response", async () => {
    const app = createApp(new MockStore(), null);
    const response = await request(app).get("/api/dashboard").expect(200);
    expect(response.body.event.exposureEventId).toBe(255539);
    expect(response.body.programs).toHaveLength(1);
    expect(response.body.programs[0].teams).toHaveLength(0);
  });

  it("lets a user follow and unfollow a selected team", async () => {
    const app = createApp(new MockStore(), null);
    await request(app).post("/api/teams/team-splash-4th/follow").expect(201);
    const followed = await request(app).get("/api/dashboard").expect(200);
    expect(followed.body.programs[0].teams.map((team: { id: string }) => team.id)).toContain("team-splash-4th");
    await request(app).delete("/api/teams/team-splash-4th/follow").expect(204);
    const unfollowed = await request(app).get("/api/dashboard").expect(200);
    expect(unfollowed.body.programs[0].teams).toHaveLength(0);
  });

  it("searches teams by registered player name when roster data exists", async () => {
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
        lastSeenAt: new Date().toISOString()
      }
    ];
    const app = createApp(new MockStore(snapshot), null);
    const response = await request(app).get("/api/teams?search=Jordan").expect(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].id).toBe("team-splash-4th");
    expect(response.body[0].playerMatchNames).toEqual(["Jordan Sample"]);
  });

  it("protects admin sync with ADMIN_SECRET when configured", async () => {
    process.env.ADMIN_SECRET = "test-secret";
    const app = createApp(new MockStore(), null);
    await request(app).post("/api/admin/sync-now").expect(401);
    await request(app).post("/api/admin/sync-now").set("x-admin-secret", "test-secret").expect(200);
    delete process.env.ADMIN_SECRET;
  });
});
