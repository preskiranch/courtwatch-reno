import { describe, expect, it } from "vitest";
import { ApiResponseError } from "./api";
import { queryRetryDelay, shouldRetryQuery } from "./query-policy";

describe("query policy", () => {
  it("retries transient network and upstream failures at most twice", () => {
    expect(shouldRetryQuery(0, new TypeError("fetch failed"))).toBe(true);
    expect(shouldRetryQuery(1, new ApiResponseError(503, "unavailable"))).toBe(
      true,
    );
    expect(shouldRetryQuery(2, new ApiResponseError(503, "unavailable"))).toBe(
      false,
    );
  });

  it("does not retry authentication, validation, or missing resources", () => {
    expect(shouldRetryQuery(0, new ApiResponseError(401, "unauthorized"))).toBe(
      false,
    );
    expect(shouldRetryQuery(0, new ApiResponseError(404, "missing"))).toBe(
      false,
    );
    expect(shouldRetryQuery(0, new ApiResponseError(422, "invalid"))).toBe(
      false,
    );
  });

  it("uses a short capped exponential delay", () => {
    expect(queryRetryDelay(0)).toBe(750);
    expect(queryRetryDelay(1)).toBe(1_500);
    expect(queryRetryDelay(10)).toBe(3_000);
  });
});
