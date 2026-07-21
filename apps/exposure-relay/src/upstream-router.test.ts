import { describe, expect, it, vi } from "vitest";
import {
  containedTargetUrl,
  type FetchLike,
  ResilientUpstreamRouter,
  UpstreamRoutesError,
} from "./upstream-router.js";

const request = {
  delegateCredential: "relay-secret",
  headers: { Accept: "application/json" },
  method: "GET",
  pathname: "/robots.txt",
};

describe("ResilientUpstreamRouter", () => {
  it("uses the healthy delegate without calling the direct route", async () => {
    const fetchImpl = vi.fn<FetchLike>(
      async () => new Response("ok", { status: 200 }),
    );
    const router = createRouter(fetchImpl);

    const result = await router.fetch(request);

    expect(result.route).toBe("delegate");
    expect(result.attempts).toEqual([
      expect.objectContaining({ outcome: "response", status: 200 }),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(
      new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get(
        "X-CourtWatch-Relay-Key",
      ),
    ).toBe("relay-secret");
  });

  it("falls back directly after a transient delegate response", async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const router = createRouter(fetchImpl);

    const result = await router.fetch(request);

    expect(result.route).toBe("direct");
    expect(result.attempts.map((attempt) => attempt.status)).toEqual([
      502, 200,
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(
      new Headers(fetchImpl.mock.calls[1]?.[1]?.headers).has(
        "X-CourtWatch-Relay-Key",
      ),
    ).toBe(false);
  });

  it("falls back directly after a delegate network failure", async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const router = createRouter(fetchImpl);

    const result = await router.fetch(request);

    expect(result.route).toBe("direct");
    expect(result.attempts.map((attempt) => attempt.outcome)).toEqual([
      "error",
      "response",
    ]);
  });

  it("opens the delegate circuit and retries it after the cooldown", async () => {
    let now = Date.parse("2026-07-21T12:00:00.000Z");
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(new Response("bad", { status: 502 }))
      .mockResolvedValueOnce(new Response("direct", { status: 200 }))
      .mockResolvedValueOnce(new Response("bad", { status: 502 }))
      .mockResolvedValueOnce(new Response("direct", { status: 200 }))
      .mockResolvedValueOnce(new Response("direct", { status: 200 }))
      .mockResolvedValueOnce(
        new Response("delegate recovered", { status: 200 }),
      );
    const router = createRouter(fetchImpl, { now: () => now });

    await router.fetch(request);
    await router.fetch(request);
    const whileOpen = await router.fetch(request);

    expect(whileOpen.route).toBe("direct");
    expect(whileOpen.attempts).toHaveLength(1);
    expect(router.snapshot().state).toBe("open");

    now += 60_001;
    const recovered = await router.fetch(request);
    expect(recovered.route).toBe("delegate");
    expect(router.snapshot()).toEqual({
      consecutiveFailures: 0,
      openUntil: null,
      state: "closed",
    });
  });

  it("preserves non-transient delegate responses", async () => {
    const fetchImpl = vi.fn<FetchLike>(
      async () => new Response("unauthorized", { status: 401 }),
    );
    const router = createRouter(fetchImpl);

    const result = await router.fetch(request);

    expect(result.route).toBe("delegate");
    expect(result.response.status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports a timeout when every route exceeds its deadline", async () => {
    const fetchImpl = vi.fn<FetchLike>(
      (_url: URL, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        }),
    );
    const router = createRouter(fetchImpl, {
      delegateAttemptTimeoutMs: 5,
      totalTimeoutMs: 10,
    });

    const result = router.fetch(request);

    await expect(result).rejects.toMatchObject({
      attempts: [
        expect.objectContaining({ outcome: "timeout", route: "delegate" }),
        expect.objectContaining({ outcome: "timeout", route: "direct" }),
      ],
      timedOut: true,
    } satisfies Partial<UpstreamRoutesError>);
  });
});

describe("containedTargetUrl", () => {
  it("cannot be redirected to a caller-controlled host", () => {
    const target = containedTargetUrl(
      "https://official.example.test",
      "//attacker.example.test/steal",
      "?safe=1",
    );

    expect(target.origin).toBe("https://official.example.test");
    expect(target.pathname).toBe("//attacker.example.test/steal");
    expect(target.search).toBe("?safe=1");
  });
});

function createRouter(
  fetchImpl: FetchLike,
  overrides: Partial<
    ConstructorParameters<typeof ResilientUpstreamRouter>[0]
  > = {},
) {
  return new ResilientUpstreamRouter({
    circuitCooldownMs: 60_000,
    circuitFailureThreshold: 2,
    delegateAttemptTimeoutMs: 100,
    delegateOrigin: "https://delegate.example.test",
    fetchImpl,
    totalTimeoutMs: 1_000,
    upstreamOrigin: "https://official.example.test",
    ...overrides,
  });
}
