const EXPOSURE_HOSTNAME = "basketball.exposureevents.com";
const RELAY_HEADER = "X-CourtWatch-Relay-Key";

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

  return fetchImpl(
    new Request(relayUrl, {
      body,
      headers,
      method: originalRequest.method,
      redirect: originalRequest.redirect,
      signal: originalRequest.signal,
    }),
  );
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
