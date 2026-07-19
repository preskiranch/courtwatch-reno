import { ApiResponseError } from "./api";

const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export function shouldRetryQuery(
  failureCount: number,
  error: unknown,
): boolean {
  if (failureCount >= 2) return false;

  if (error instanceof ApiResponseError) {
    return RETRYABLE_HTTP_STATUSES.has(error.status);
  }

  return error instanceof TypeError || isAbortOrTimeoutError(error);
}

export function queryRetryDelay(attemptIndex: number): number {
  return Math.min(750 * 2 ** Math.max(0, attemptIndex), 3_000);
}

function isAbortOrTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || error.name === "TimeoutError";
}
