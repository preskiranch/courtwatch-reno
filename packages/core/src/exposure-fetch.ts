const EXPOSURE_HOSTNAME = "basketball.exposureevents.com";
const RELAY_HEADER = "X-CourtWatch-Relay-Key";
const RELAY_RESPONSE_HEADER = "X-CourtWatch-Relay";
const DEFAULT_RELAY_ATTEMPT_TIMEOUT_MS = 4_000;

export async function exposureFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  return fetchWithExposureRelay(fetch, input, init);
}

export async function fetchWithExposureRelay(
  fetchImpl: typeof fetch,
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const relayBaseUrl = process.env.EXPOSURE_RELAY_BASE_URL?.trim();
  const relayToken = process.env.EXPOSURE_RELAY_TOKEN?.trim();
  if (!relayBaseUrl && !relayToken) return fetchImpl(input, init);
  if (!relayBaseUrl || !relayToken) {
    throw new Error(
      "EXPOSURE_RELAY_BASE_URL and EXPOSURE_RELAY_TOKEN must be configured together.",
    );
  }

  const originalRequest = new Request(input, init);
  const originalUrl = new URL(originalRequest.url);
  if (originalUrl.hostname.toLowerCase() !== EXPOSURE_HOSTNAME) {
    return fetchImpl(originalRequest);
  }

  const relayUrl = new URL(
    `${originalUrl.pathname}${originalUrl.search}`,
    ensureTrailingSlash(relayBaseUrl),
  );
  const headers = new Headers(originalRequest.headers);
  headers.set(RELAY_HEADER, relayToken);
  const body = ["GET", "HEAD"].includes(originalRequest.method)
    ? undefined
    : await originalRequest.clone().arrayBuffer();
  const relayController = new AbortController();
  const relayTimeout = setTimeout(
    () => relayController.abort(new Error("Exposure relay attempt timed out")),
    relayAttemptTimeoutMs(),
  );
  const abortRelay = () => relayController.abort(originalRequest.signal.reason);
  originalRequest.signal.addEventListener("abort", abortRelay, { once: true });

  let relayResponse: Response;
  try {
    relayResponse = await fetchImpl(
      new Request(relayUrl, {
        body,
        headers,
        method: originalRequest.method,
        redirect: originalRequest.redirect,
        signal: relayController.signal,
      }),
    );
  } catch (error) {
    if (originalRequest.signal.aborted) throw error;
    return fetchImpl(originalRequest);
  } finally {
    clearTimeout(relayTimeout);
    originalRequest.signal.removeEventListener("abort", abortRelay);
  }

  // A marked response reached Exposure through the relay. Preserve its status so
  // callers can immediately use their public-page fallback instead of retrying
  // the blocked direct connection from Render.
  if (
    relayResponse.headers.has(RELAY_RESPONSE_HEADER) ||
    !isTransientRelayStatus(relayResponse.status)
  ) {
    return relayResponse;
  }
  await relayResponse.body?.cancel().catch(() => undefined);
  if (originalRequest.signal.aborted) {
    throw originalRequest.signal.reason ?? new Error("Request aborted");
  }
  return fetchImpl(originalRequest);
}

function relayAttemptTimeoutMs(): number {
  const configured = Number(process.env.EXPOSURE_RELAY_ATTEMPT_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_RELAY_ATTEMPT_TIMEOUT_MS;
}

function isTransientRelayStatus(status: number): boolean {
  return [408, 425].includes(status) || status >= 500;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
