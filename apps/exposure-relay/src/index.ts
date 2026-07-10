import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const port = positiveInteger(process.env.PORT, 10_000);
const upstreamOrigin = normalizedOrigin(
  process.env.UPSTREAM_ORIGIN ?? "https://basketball.exposureevents.com",
);
const sharedSecret = process.env.RELAY_SHARED_SECRET?.trim() ?? "";
const upstreamTimeoutMs = positiveInteger(
  process.env.RELAY_UPSTREAM_TIMEOUT_MS,
  30_000,
);
const maxRequestBodyBytes = positiveInteger(
  process.env.RELAY_MAX_BODY_BYTES,
  2 * 1024 * 1024,
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

  if (!authorized(request)) {
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
  const timer = setTimeout(() => controller.abort(), upstreamTimeoutMs);
  const abortUpstream = () => controller.abort();
  request.once("aborted", abortUpstream);

  try {
    const body =
      request.method === "POST"
        ? await readRequestBody(request, maxRequestBodyBytes)
        : undefined;
    const targetUrl = new URL(
      `${requestUrl.pathname}${requestUrl.search}`,
      upstreamOrigin,
    );
    const upstreamResponse = await fetch(targetUrl, {
      body,
      headers: upstreamRequestHeaders(request),
      method: request.method,
      redirect: "follow",
      signal: controller.signal,
    });

    updateProbe(true, upstreamResponse.status, Date.now() - startedAt);
    response.statusCode = upstreamResponse.status;
    copyResponseHeaders(upstreamResponse.headers, response);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-CourtWatch-Relay", "ohio");

    if (request.method === "HEAD" || !upstreamResponse.body) {
      response.end();
    } else {
      response.end(Buffer.from(await upstreamResponse.arrayBuffer()));
    }

    logRequest(request, requestUrl, upstreamResponse.status, startedAt);
  } catch (error) {
    const timedOut = controller.signal.aborted;
    updateProbe(false, null, Date.now() - startedAt);
    if (!response.headersSent) {
      writeJson(response, timedOut ? 504 : 502, {
        error: timedOut ? "Upstream request timed out" : "Upstream request failed",
      });
    } else {
      response.destroy();
    }
    console.error(
      JSON.stringify({
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "Unknown error",
        method: request.method,
        path: requestUrl.pathname,
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
      port,
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
    const response = await fetch(new URL("/robots.txt", upstreamOrigin), {
      headers: { "User-Agent": "CourtWatch-AAU-Health/1.0" },
      signal: controller.signal,
    });
    updateProbe(response.ok, response.status, Date.now() - startedAt);
    await response.body?.cancel();
  } catch {
    updateProbe(false, null, Date.now() - startedAt);
  } finally {
    clearTimeout(timer);
  }
}

function authorized(request: IncomingMessage): boolean {
  if (!sharedSecret) return process.env.NODE_ENV !== "production";
  const provided = request.headers["x-courtwatch-relay-key"];
  if (typeof provided !== "string") return false;
  const actualBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(sharedSecret);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function upstreamRequestHeaders(request: IncomingMessage): Headers {
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
  return headers;
}

function copyResponseHeaders(headers: Headers, response: ServerResponse) {
  const blockedHeaders = new Set([
    "connection",
    "content-encoding",
    "keep-alive",
    "transfer-encoding",
  ]);
  headers.forEach((value, name) => {
    if (!blockedHeaders.has(name.toLowerCase())) response.setHeader(name, value);
  });
}

async function readRequestBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("Request body exceeded relay limit");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
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
  if (url.protocol !== "https:") throw new Error("UPSTREAM_ORIGIN must use HTTPS.");
  return url.origin;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
