import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("web health endpoint", () => {
  it("returns an uncached healthy response", async () => {
    const response = GET();
    const body = (await response.json()) as {
      ok: boolean;
      service: string;
      timestamp: string;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.ok).toBe(true);
    expect(body.service).toBe("courtwatch-web");
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });
});
