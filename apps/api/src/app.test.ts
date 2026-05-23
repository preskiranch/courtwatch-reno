import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { MockStore } from "./store.js";

describe("CourtWatch API", () => {
  it("returns a dashboard response", async () => {
    const app = createApp(new MockStore(), null);
    const response = await request(app).get("/api/dashboard").expect(200);
    expect(response.body.event.exposureEventId).toBe(255539);
    expect(response.body.programs).toHaveLength(2);
  });

  it("protects admin sync with ADMIN_SECRET when configured", async () => {
    process.env.ADMIN_SECRET = "test-secret";
    const app = createApp(new MockStore(), null);
    await request(app).post("/api/admin/sync-now").expect(401);
    await request(app).post("/api/admin/sync-now").set("x-admin-secret", "test-secret").expect(200);
    delete process.env.ADMIN_SECRET;
  });
});
