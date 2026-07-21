const TRANSIENT_NETWORK_CODES = new Set([
  "EAI_AGAIN",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const TRANSIENT_SOURCE_STATUS_PATTERN =
  /(?:public |exposure |relay |source ).*request failed with (?:403|408|410|425|429|500|502|503|504)\b/i;

const TRANSIENT_SOURCE_MESSAGE_PATTERNS = [
  /\bfetch failed\b/i,
  /\bnetwork (?:error|failure)\b/i,
  /\boperation was aborted\b/i,
  /\brelay attempt timed out\b/i,
  /\brequest timed out\b/i,
  /\bupstream .*timed out\b/i,
];

type ErrorLike = {
  cause?: unknown;
  code?: unknown;
  message?: unknown;
  name?: unknown;
};

export function isUpstreamSourceUnavailableError(error: unknown): boolean {
  const visited = new Set<unknown>();
  let current: unknown = error;

  while (current !== null && current !== undefined && !visited.has(current)) {
    visited.add(current);
    const details = errorDetails(current);
    if (!details) return false;

    if (details.name === "AbortError" || details.name === "TimeoutError") {
      return true;
    }
    if (
      typeof details.code === "string" &&
      TRANSIENT_NETWORK_CODES.has(details.code)
    ) {
      return true;
    }
    if (
      typeof details.message === "string" &&
      (TRANSIENT_SOURCE_STATUS_PATTERN.test(details.message) ||
        TRANSIENT_SOURCE_MESSAGE_PATTERNS.some((pattern) =>
          pattern.test(details.message as string),
        ))
    ) {
      return true;
    }

    current = details.cause;
  }

  return false;
}

function errorDetails(error: unknown): ErrorLike | null {
  if (error instanceof Error) return error as Error & ErrorLike;
  if (typeof error === "object" && error !== null) return error as ErrorLike;
  if (typeof error === "string") return { message: error };
  return null;
}
