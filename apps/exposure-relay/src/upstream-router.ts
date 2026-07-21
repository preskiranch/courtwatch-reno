export type UpstreamRoute = "delegate" | "direct";

export type UpstreamAttempt = {
  durationMs: number;
  error?: string;
  outcome: "response" | "error" | "timeout";
  route: UpstreamRoute;
  status?: number;
};

export type CircuitSnapshot = {
  consecutiveFailures: number;
  openUntil: string | null;
  state: "closed" | "open" | "half_open";
};

export type RoutedResponse = {
  attempts: UpstreamAttempt[];
  circuit: CircuitSnapshot;
  response: Response;
  route: UpstreamRoute;
};

export type FetchLike = (url: URL, init: RequestInit) => Promise<Response>;

type RouterOptions = {
  circuitCooldownMs?: number;
  circuitFailureThreshold?: number;
  delegateAttemptTimeoutMs?: number;
  delegateOrigin?: string;
  fetchImpl?: FetchLike;
  now?: () => number;
  totalTimeoutMs: number;
  upstreamOrigin: string;
};

type RouteRequest = {
  body?: string;
  delegateCredential?: string;
  headers?: HeadersInit;
  method: string;
  parentSignal?: AbortSignal;
  pathname: string;
  search?: string;
};

class AttemptFailure extends Error {
  constructor(
    message: string,
    readonly attempt: UpstreamAttempt,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AttemptFailure";
  }
}

export class UpstreamRoutesError extends Error {
  readonly timedOut: boolean;

  constructor(
    readonly attempts: UpstreamAttempt[],
    options?: ErrorOptions,
  ) {
    super("All upstream routes failed", options);
    this.name = "UpstreamRoutesError";
    this.timedOut = attempts.some((attempt) => attempt.outcome === "timeout");
  }
}

class DelegateCircuitBreaker {
  private consecutiveFailures = 0;
  private openUntil = 0;
  private trialInFlight = false;

  constructor(
    private readonly failureThreshold: number,
    private readonly cooldownMs: number,
  ) {}

  tryAcquire(now: number): boolean {
    if (this.openUntil === 0) return true;
    if (now < this.openUntil || this.trialInFlight) return false;
    this.trialInFlight = true;
    return true;
  }

  recordSuccess() {
    this.consecutiveFailures = 0;
    this.openUntil = 0;
    this.trialInFlight = false;
  }

  recordFailure(now: number) {
    this.consecutiveFailures += 1;
    if (
      this.trialInFlight ||
      this.consecutiveFailures >= this.failureThreshold
    ) {
      this.openUntil = now + this.cooldownMs;
    }
    this.trialInFlight = false;
  }

  release() {
    this.trialInFlight = false;
  }

  snapshot(now: number): CircuitSnapshot {
    const state =
      this.openUntil === 0
        ? "closed"
        : now < this.openUntil
          ? "open"
          : "half_open";
    return {
      consecutiveFailures: this.consecutiveFailures,
      openUntil:
        this.openUntil > now ? new Date(this.openUntil).toISOString() : null,
      state,
    };
  }
}

export class ResilientUpstreamRouter {
  private readonly breaker: DelegateCircuitBreaker;
  private readonly delegateAttemptTimeoutMs: number;
  private readonly delegateOrigin?: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly totalTimeoutMs: number;
  private readonly upstreamOrigin: string;

  constructor(options: RouterOptions) {
    this.delegateOrigin = options.delegateOrigin;
    this.upstreamOrigin = options.upstreamOrigin;
    this.totalTimeoutMs = options.totalTimeoutMs;
    this.delegateAttemptTimeoutMs =
      options.delegateAttemptTimeoutMs ??
      Math.min(5_000, options.totalTimeoutMs);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.breaker = new DelegateCircuitBreaker(
      options.circuitFailureThreshold ?? 2,
      options.circuitCooldownMs ?? 60_000,
    );
  }

  async fetch(request: RouteRequest): Promise<RoutedResponse> {
    const startedAt = this.now();
    const attempts: UpstreamAttempt[] = [];

    if (this.delegateOrigin && this.breaker.tryAcquire(this.now())) {
      try {
        const response = await this.attempt(
          "delegate",
          this.delegateOrigin,
          request,
          Math.min(
            this.delegateAttemptTimeoutMs,
            this.remainingTime(startedAt),
          ),
        );
        attempts.push(response.attempt);
        if (!isTransientStatus(response.response.status)) {
          this.breaker.recordSuccess();
          return this.result(response.response, "delegate", attempts);
        }

        this.breaker.recordFailure(this.now());
        await response.response.body?.cancel();
      } catch (error) {
        const failure = asAttemptFailure(error, "delegate");
        attempts.push(failure.attempt);
        if (request.parentSignal?.aborted) {
          this.breaker.release();
          throw new UpstreamRoutesError(attempts, { cause: failure });
        }
        this.breaker.recordFailure(this.now());
      }
    }

    try {
      const response = await this.attempt(
        "direct",
        this.upstreamOrigin,
        request,
        this.remainingTime(startedAt),
      );
      attempts.push(response.attempt);
      return this.result(response.response, "direct", attempts);
    } catch (error) {
      const failure = asAttemptFailure(error, "direct");
      attempts.push(failure.attempt);
      throw new UpstreamRoutesError(attempts, { cause: failure });
    }
  }

  snapshot(): CircuitSnapshot {
    return this.breaker.snapshot(this.now());
  }

  private async attempt(
    route: UpstreamRoute,
    origin: string,
    request: RouteRequest,
    timeoutMs: number,
  ): Promise<{ attempt: UpstreamAttempt; response: Response }> {
    if (timeoutMs <= 0) {
      throw new AttemptFailure("Upstream request deadline exceeded", {
        durationMs: 0,
        outcome: "timeout",
        route,
      });
    }

    const startedAt = this.now();
    const timeout = linkedTimeout(request.parentSignal, timeoutMs);
    try {
      const headers = new Headers(request.headers);
      if (route === "delegate" && request.delegateCredential) {
        headers.set("X-CourtWatch-Relay-Key", request.delegateCredential);
      } else {
        headers.delete("X-CourtWatch-Relay-Key");
      }
      const response = await this.fetchImpl(
        containedTargetUrl(origin, request.pathname, request.search),
        {
          body: request.body,
          headers,
          method: request.method,
          redirect: "follow",
          signal: timeout.signal,
        },
      );
      return {
        attempt: {
          durationMs: this.now() - startedAt,
          outcome: "response",
          route,
          status: response.status,
        },
        response,
      };
    } catch (error) {
      const timedOut = timeout.didTimeOut();
      throw new AttemptFailure(
        timedOut ? "Upstream route timed out" : "Upstream route failed",
        {
          durationMs: this.now() - startedAt,
          error: errorMessage(error),
          outcome: timedOut ? "timeout" : "error",
          route,
        },
        { cause: error },
      );
    } finally {
      timeout.cleanup();
    }
  }

  private remainingTime(startedAt: number): number {
    return Math.max(0, this.totalTimeoutMs - (this.now() - startedAt));
  }

  private result(
    response: Response,
    route: UpstreamRoute,
    attempts: UpstreamAttempt[],
  ): RoutedResponse {
    return {
      attempts,
      circuit: this.breaker.snapshot(this.now()),
      response,
      route,
    };
  }
}

export function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function containedTargetUrl(
  origin: string,
  pathname: string,
  search = "",
): URL {
  const target = new URL(origin);
  target.pathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
  target.search = search;
  return target;
}

function linkedTimeout(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(parent?.reason);
  if (parent?.aborted) abortFromParent();
  else parent?.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(
      new DOMException("Upstream route timed out", "TimeoutError"),
    );
  }, timeoutMs);
  timer.unref?.();

  return {
    cleanup() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abortFromParent);
    },
    didTimeOut: () => timedOut,
    signal: controller.signal,
  };
}

function asAttemptFailure(
  error: unknown,
  route: UpstreamRoute,
): AttemptFailure {
  return error instanceof AttemptFailure
    ? error
    : new AttemptFailure(
        "Upstream route failed",
        {
          durationMs: 0,
          error: errorMessage(error),
          outcome: "error",
          route,
        },
        { cause: error },
      );
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Unknown error";
  const cause = error.cause;
  if (cause instanceof Error) return `${error.message}: ${cause.message}`;
  return error.message;
}
