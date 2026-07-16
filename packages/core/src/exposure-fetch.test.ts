import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithExposureRelay } from "./exposure-fetch.js";

const originalRelayUrl = process.env.EXPOSURE_RELAY_BASE_URL;
const originalRelayToken = process.env.EXPOSURE_RELAY_TOKEN;
const originalRelayAttemptTimeout =
  process.env.EXPOSURE_RELAY_ATTEMPT_TIMEOUT_MS;

afterEach(() => {
  vi.restoreAllMocks();
  restoreEnv("EXPOSURE_RELAY_BASE_URL", originalRelayUrl);
  restoreEnv("EXPOSURE_RELAY_TOKEN", originalRelayToken);
  restoreEnv("EXPOSURE_RELAY_ATTEMPT_TIMEOUT_MS", originalRelayAttemptTimeout);
});

describe("fetchWithExposureRelay", () => {
  it("routes Exposure requests through the configured authenticated relay", async () => {
    process.env.EXPOSURE_RELAY_BASE_URL = "https://relay.example.test";
    process.env.EXPOSURE_RELAY_TOKEN = "relay-secret";
    const fetchImpl = vi.fn(async () => new Response("ok"));

    await fetchWithExposureRelay(
      fetchImpl,
      "https://basketball.exposureevents.com/255539/event/schedule?division=7",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "page=1",
      },
    );

    expect(fetchImpl).toHaveBeenCalledOnce();
    const relayedRequest = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(relayedRequest).toBeInstanceOf(Request);
    expect(relayedRequest.url).toBe(
      "https://relay.example.test/255539/event/schedule?division=7",
    );
    expect(relayedRequest.headers.get("X-CourtWatch-Relay-Key")).toBe(
      "relay-secret",
    );
    expect(await relayedRequest.text()).toBe("page=1");
  });

  it("does not relay non-Exposure requests", async () => {
    process.env.EXPOSURE_RELAY_BASE_URL = "https://relay.example.test";
    process.env.EXPOSURE_RELAY_TOKEN = "relay-secret";
    const fetchImpl = vi.fn(async () => new Response("ok"));

    await fetchWithExposureRelay(fetchImpl, "https://example.com/events");

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe("https://example.com/events");
    expect(request.headers.has("X-CourtWatch-Relay-Key")).toBe(false);
  });

  it("uses the original URL when no relay is configured", async () => {
    delete process.env.EXPOSURE_RELAY_BASE_URL;
    delete process.env.EXPOSURE_RELAY_TOKEN;
    const fetchImpl = vi.fn(async () => new Response("ok"));

    await fetchWithExposureRelay(
      fetchImpl,
      "https://basketball.exposureevents.com/255539/event",
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://basketball.exposureevents.com/255539/event",
      undefined,
    );
  });

  it("rejects a partial relay configuration", async () => {
    process.env.EXPOSURE_RELAY_BASE_URL = "https://relay.example.test";
    delete process.env.EXPOSURE_RELAY_TOKEN;

    await expect(
      fetchWithExposureRelay(
        vi.fn(async () => new Response("ok")),
        "https://basketball.exposureevents.com/255539/event",
      ),
    ).rejects.toThrow("must be configured together");
  });

  it("falls back to the original Exposure URL after a transient relay response", async () => {
    process.env.EXPOSURE_RELAY_BASE_URL = "https://relay.example.test";
    process.env.EXPOSURE_RELAY_TOKEN = "relay-secret";
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("gateway timeout", { status: 504 }))
      .mockResolvedValueOnce(new Response("official teams", { status: 200 }));

    const response = await fetchWithExposureRelay(
      fetchImpl,
      "https://basketball.exposureevents.com/265801/event/teams",
    );

    expect(await response.text()).toBe("official teams");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const directRequest = fetchImpl.mock.calls[1]?.[0] as Request;
    expect(directRequest.url).toBe(
      "https://basketball.exposureevents.com/265801/event/teams",
    );
    expect(directRequest.headers.has("X-CourtWatch-Relay-Key")).toBe(false);
  });

  it("falls back to the original Exposure URL when the relay request throws", async () => {
    process.env.EXPOSURE_RELAY_BASE_URL = "https://relay.example.test";
    process.env.EXPOSURE_RELAY_TOKEN = "relay-secret";
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("relay unavailable"))
      .mockResolvedValueOnce(new Response("official teams", { status: 200 }));

    const response = await fetchWithExposureRelay(
      fetchImpl,
      "https://basketball.exposureevents.com/252638/event/teams",
    );

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not hide a non-transient official relay response", async () => {
    process.env.EXPOSURE_RELAY_BASE_URL = "https://relay.example.test";
    process.env.EXPOSURE_RELAY_TOKEN = "relay-secret";
    const fetchImpl = vi.fn(
      async () => new Response("not found", { status: 404 }),
    );

    const response = await fetchWithExposureRelay(
      fetchImpl,
      "https://basketball.exposureevents.com/999999/event/teams",
    );

    expect(response.status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("falls back when the relay attempt exceeds its time budget", async () => {
    process.env.EXPOSURE_RELAY_BASE_URL = "https://relay.example.test";
    process.env.EXPOSURE_RELAY_TOKEN = "relay-secret";
    process.env.EXPOSURE_RELAY_ATTEMPT_TIMEOUT_MS = "5";
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        (request) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = (request as Request).signal;
            signal.addEventListener(
              "abort",
              () => reject(signal.reason ?? new Error("aborted")),
              { once: true },
            );
          }),
      )
      .mockResolvedValueOnce(new Response("official teams", { status: 200 }));

    const response = await fetchWithExposureRelay(
      fetchImpl,
      "https://basketball.exposureevents.com/258555/event/teams",
    );

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
