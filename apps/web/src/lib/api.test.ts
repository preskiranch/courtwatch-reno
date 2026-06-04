import { beforeEach, describe, expect, it, vi } from "vitest";
import { CourtWatchApi } from "./api";

describe("CourtWatchApi team search", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 200 })),
    );
  });

  it("keeps selected-tournament team searches scoped to the event", async () => {
    await CourtWatchApi.teams("707", 264313);

    const [url] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toContain("/api/teams?search=707&eventId=264313");
    expect(String(url)).not.toContain("scope=all");
  });

  it("only uses all-event search when explicitly requested", async () => {
    await CourtWatchApi.teams("707", 264313, { allEvents: true });

    const [url] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toContain("/api/teams?search=707&scope=all");
    expect(String(url)).not.toContain("eventId=264313");
  });
});
