const webBaseUrl = normalizedUrl(
  process.env.SMOKE_WEB_BASE_URL ?? "https://courtwatchaau.com",
);
const apiBaseUrl = normalizedUrl(
  process.env.SMOKE_API_BASE_URL ?? "https://courtwatch-reno-api.onrender.com",
);
const relayBaseUrl = normalizedUrl(
  process.env.SMOKE_RELAY_BASE_URL ??
    "https://courtwatch-exposure-relay.onrender.com",
);
const requestTimeoutMs = positiveInteger(
  process.env.SMOKE_REQUEST_TIMEOUT_MS,
  10_000,
);
const maxAttempts = positiveInteger(process.env.SMOKE_MAX_ATTEMPTS, 3);

const checks = [
  {
    name: "web health",
    url: new URL("/api/health", webBaseUrl),
    validate: (body) => body?.ok === true && body?.service === "courtwatch-web",
  },
  {
    name: "api liveness",
    url: new URL("/api/health/live", apiBaseUrl),
    validate: (body) => body?.ok === true,
  },
  {
    name: "api readiness",
    url: new URL("/api/health/ready", apiBaseUrl),
    validate: (body) => body?.ok === true && body?.status !== "not_ready",
  },
  {
    name: "event catalog",
    url: new URL("/api/events", apiBaseUrl),
    validate: (body) => Array.isArray(body) && body.length > 0,
  },
  {
    name: "exposure relay",
    url: new URL("/health", relayBaseUrl),
    validate: (body) =>
      body?.ok === true &&
      body?.service === "courtwatch-exposure-relay" &&
      body?.upstream?.ok === true,
  },
];

const results = [];
for (const check of checks) {
  results.push(await runCheck(check));
}

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      ok: results.every((result) => result.ok),
      results,
    },
    null,
    2,
  ),
);

if (results.some((result) => !result.ok)) process.exitCode = 1;

async function runCheck(check) {
  let latestError = "Unknown smoke-check failure";
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        controller.abort(
          new DOMException("Smoke check timed out", "TimeoutError"),
        ),
      requestTimeoutMs,
    );
    try {
      const response = await fetch(check.url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok) {
        latestError = `HTTP ${response.status}`;
      } else if (!check.validate(body)) {
        latestError = "Response did not satisfy the health contract";
      } else {
        return {
          attempts: attempt,
          durationMs: Date.now() - startedAt,
          name: check.name,
          ok: true,
          status: response.status,
        };
      }
    } catch (error) {
      latestError = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timer);
    }

    if (attempt < maxAttempts) await wait(attempt * 1_000);
  }

  return {
    attempts: maxAttempts,
    durationMs: Date.now() - startedAt,
    error: latestError,
    name: check.name,
    ok: false,
  };
}

function normalizedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error(`Smoke-check URL must use HTTPS: ${url.origin}`);
  }
  return url.origin;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
