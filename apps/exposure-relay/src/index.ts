import { createHash, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  assertContentLengthWithinLimit,
  PayloadLimitError,
  readAsyncBodyWithLimit,
  readWebBodyWithLimit,
} from "./body-limits.js";

const relayHeader = "x-courtwatch-relay-key";
const defaultDelegateOrigin = process.env.K_SERVICE
  ? undefined
  : "https://courtwatch-exposure-relay-east-3oehk2tqgq-ue.a.run.app";
const port = positiveInteger(process.env.PORT, 10_000);
const upstreamOrigin = normalizedOrigin(
  process.env.UPSTREAM_ORIGIN ?? "https://basketball.exposureevents.com",
);
const delegateOrigin = optionalNormalizedOrigin(
  process.env.RELAY_DELEGATE_ORIGIN ?? defaultDelegateOrigin,
);
const legacyAuthOrigin = optionalNormalizedOrigin(
  process.env.RELAY_LEGACY_AUTH_ORIGIN,
);
const sharedSecret = process.env.RELAY_SHARED_SECRET?.trim() ?? "";
const relayLocation = process.env.RELAY_LOCATION?.trim() || "render-ohio";
const legacyAuthCacheTtlMs = positiveInteger(
  process.env.RELAY_LEGACY_AUTH_CACHE_TTL_MS,
  5 * 60_000,
);
const upstreamTimeoutMs = positiveInteger(
  process.env.RELAY_UPSTREAM_TIMEOUT_MS,
  30_000,
);
const maxRequestBodyBytes = positiveInteger(
  process.env.RELAY_MAX_BODY_BYTES,
  2 * 1024 * 1024,
);
const maxResponseBodyBytes = positiveInteger(
  process.env.RELAY_MAX_RESPONSE_BYTES,
  16 * 1024 * 1024,
);

if (process.env.NODE_ENV === "production" && sharedSecret.length < 32) {
  throw new Error("RELAY_SHARED_SECRET must contain at least 32 characters.");
}

type UpstreamProbe = {
  checkedAt: string | null;
  latencyMs: number | null;
  ok: boolean;
  status: number | null;
};

let upstreamProbe: UpstreamProbe = {
  checkedAt: null,
  latencyMs: null,
  ok: false,
  status: null,
};

const legacyAuthCache = new Map<string, number>();

const server = createServer(async (request, response) => {
  const startedAt = Date.now();
  const requestUrl = new URL(request.url ?? "/", "http://relay.invalid");

  if (request.method === "GET" && requestUrl.pathname === "/health") {
    writeJson(response, 200, {
      ok: true,
      service: "courtwatch-exposure-relay",
      upstream: upstreamProbe,
    });
    return;
  }

  if (!(await authorized(request))) {
    writeJson(response, 401, { error: "Unauthorized" });
    return;
  }

  if (!request.method || !["GET", "HEAD", "POST"].includes(request.method)) {
    response.setHeader("Allow", "GET, HEAD, POST");
    writeJson(response, 405, { error: "Method not allowed" });
    return;
  }

  if (requestUrl.pathname.length > 2_048 || requestUrl.search.length > 8_192) {
    writeJson(response, 414, { error: "Request URL is too long" });
    return;
  }

  const controller = new AbortController();
  let timedOut = false;
  let clientAborted = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, upstreamTimeoutMs);
  const abortUpstream = () => {
    clientAborted = true;
    controller.abort();
  };
  request.once("aborted", abortUpstream);

  try {
    const body =
      request.method === "POST"
        ? await readRequestBody(request, maxRequestBodyBytes)
        : undefined;
    const targetOrigin = delegateOrigin ?? upstreamOrigin;
    const targetUrl = new URL(
      `${requestUrl.pathname}${requestUrl.search}`,
      targetOrigin,
    );
    const upstreamResponse = await fetch(targetUrl, {
      body,
      headers: relayRequestHeaders(request, Boolean(delegateOrigin)),
      method: request.method,
      redirect: "follow",
      signal: controller.signal,
    });

    const responseBody =
      request.method === "HEAD" || !upstreamResponse.body
        ? undefined
        : await readUpstreamBody(upstreamResponse, maxResponseBodyBytes);

    updateProbe(
      upstreamResponse.ok,
      upstreamResponse.status,
      Date.now() - startedAt,
    );
    response.statusCode = upstreamResponse.status;
    copyResponseHeaders(upstreamResponse.headers, response);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-CourtWatch-Relay", relayLocation);

    response.end(responseBody);

    logRequest(request, requestUrl, upstreamResponse.status, startedAt);
  } catch (error) {
    updateProbe(false, null, Date.now() - startedAt);
    if (!clientAborted && !response.headersSent) {
      const failure = relayFailure(error, timedOut);
      writeJson(response, failure.status, { error: failure.message });
    } else {
      response.destroy();
    }
    console.error(
      JSON.stringify({
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "Unknown error",
        method: request.method,
        path: requestUrl.pathname,
        payloadDirection:
          error instanceof PayloadLimitError ? error.direction : undefined,
        timedOut,
      }),
    );
  } finally {
    clearTimeout(timer);
    request.off("aborted", abortUpstream);
  }
});

server.listen(port, () => {
  console.log(
    JSON.stringify({
      message: "Exposure relay listening",
      delegateOrigin,
      legacyAuthOrigin,
      port,
      relayLocation,
      maxRequestBodyBytes,
      maxResponseBodyBytes,
      upstreamOrigin,
    }),
  );
  void probeUpstream();
});

setInterval(() => void probeUpstream(), 30_000).unref();

async function probeUpstream() {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), upstreamTimeoutMs);
  try {
    const response = await fetch(
      new URL("/robots.txt", delegateOrigin ?? upstreamOrigin),
      {
        headers: {
          "User-Agent": "CourtWatch-AAU-Health/1.0",
          ...(delegateOrigin && sharedSecret
            ? { "X-CourtWatch-Relay-Key": sharedSecret }
            : {}),
        },
        signal: controller.signal,
      },
    );
    updateProbe(response.ok, response.status, Date.now() - startedAt);
    await response.body?.cancel();
  } catch {
    updateProbe(false, null, Date.now() - startedAt);
  } finally {
    clearTimeout(timer);
  }
}

async function authorized(request: IncomingMessage): Promise<boolean> {
  const provided = request.headers[relayHeader];
  if (typeof provided !== "string") return false;
  if (sharedSecret && secretsMatch(provided, sharedSecret)) return true;
  if (!legacyAuthOrigin) {
    return !sharedSecret && process.env.NODE_ENV !== "production";
  }

  const credentialHash = createHash("sha256").update(provided).digest("hex");
  const cachedUntil = legacyAuthCache.get(credentialHash) ?? 0;
  if (cachedUntil > Date.now()) return true;
  if (cachedUntil) legacyAuthCache.delete(credentialHash);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(
      new URL("/__relay-auth-check", legacyAuthOrigin),
      {
        headers: { "X-CourtWatch-Relay-Key": provided },
        method: "OPTIONS",
        redirect: "manual",
        signal: controller.signal,
      },
    );
    await response.body?.cancel();
    const valid = response.status === 405;
    if (valid) {
      legacyAuthCache.set(credentialHash, Date.now() + legacyAuthCacheTtlMs);
      pruneLegacyAuthCache();
    }
    return valid;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function pruneLegacyAuthCache() {
  if (legacyAuthCache.size < 100) return;
  const now = Date.now();
  for (const [key, expiresAt] of legacyAuthCache) {
    if (expiresAt <= now) legacyAuthCache.delete(key);
  }
}

function secretsMatch(provided: string, expected: string): boolean {
  const actualBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function relayRequestHeaders(
  request: IncomingMessage,
  includeRelayCredential: boolean,
): Headers {
  const headers = new Headers();
  const allowedHeaders = [
    "accept",
    "accept-language",
    "authentication",
    "content-type",
    "cookie",
    "timestamp",
    "user-agent",
    "x-exposure-token",
    "x-requested-with",
  ];
  for (const name of allowedHeaders) {
    const value = request.headers[name];
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(", "));
  }
  if (includeRelayCredential) {
    const relayCredential = request.headers[relayHeader];
    if (typeof relayCredential === "string") {
      headers.set("X-CourtWatch-Relay-Key", relayCredential);
    }
  }
  return headers;
}

function copyResponseHeaders(headers: Headers, response: ServerResponse) {
  const blockedHeaders = new Set([
    "connection",
    "content-encoding",
    "content-length",
    "keep-alive",
    "transfer-encoding",
  ]);
  headers.forEach((value, name) => {
    if (!blockedHeaders.has(name.toLowerCase()))
      response.setHeader(name, value);
  });
}

async function readRequestBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<string> {
  assertContentLengthWithinLimit(
    typeof request.headers["content-length"] === "string"
      ? request.headers["content-length"]
      : undefined,
    maxBytes,
    "request",
  );
  return (await readAsyncBodyWithLimit(request, maxBytes, "request")).toString(
    "utf8",
  );
}

async function readUpstreamBody(
  upstreamResponse: Response,
  maxBytes: number,
): Promise<Buffer> {
  assertContentLengthWithinLimit(
    upstreamResponse.headers.get("content-length"),
    maxBytes,
    "response",
  );
  if (!upstreamResponse.body) return Buffer.alloc(0);
  return readWebBodyWithLimit(upstreamResponse.body, maxBytes);
}

function relayFailure(
  error: unknown,
  timedOut: boolean,
): { message: string; status: number } {
  if (error instanceof PayloadLimitError) {
    return error.direction === "request"
      ? { message: "Request body is too large", status: 413 }
      : { message: "Upstream response exceeded the relay limit", status: 502 };
  }
  return timedOut
    ? { message: "Upstream request timed out", status: 504 }
    : { message: "Upstream request failed", status: 502 };
}

function updateProbe(ok: boolean, status: number | null, latencyMs: number) {
  upstreamProbe = {
    checkedAt: new Date().toISOString(),
    latencyMs,
    ok,
    status,
  };
}

function logRequest(
  request: IncomingMessage,
  url: URL,
  status: number,
  startedAt: number,
) {
  console.log(
    JSON.stringify({
      durationMs: Date.now() - startedAt,
      method: request.method,
      path: url.pathname,
      status,
    }),
  );
}

function writeJson(response: ServerResponse, status: number, value: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(value));
}

function normalizedOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:")
    throw new Error("UPSTREAM_ORIGIN must use HTTPS.");
  return url.origin;
}

function optionalNormalizedOrigin(
  value: string | undefined,
): string | undefined {
  return value?.trim() ? normalizedOrigin(value) : undefined;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
