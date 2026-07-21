import { describe, expect, it } from "vitest";
import { isUpstreamSourceUnavailableError } from "./upstream-source-error.js";

describe("isUpstreamSourceUnavailableError", () => {
  it.each(["AbortError", "TimeoutError"])("recognizes %s errors", (name) => {
    const error = new Error("The operation was interrupted");
    error.name = name;
    expect(isUpstreamSourceUnavailableError(error)).toBe(true);
  });

  it("recognizes nested fetch transport failures", () => {
    const error = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connection timed out"), {
        code: "UND_ERR_CONNECT_TIMEOUT",
      }),
    });
    expect(isUpstreamSourceUnavailableError(error)).toBe(true);
  });

  it.each([403, 408, 410, 429, 500, 502, 503, 504])(
    "recognizes a transient public source HTTP %s response",
    (status) => {
      expect(
        isUpstreamSourceUnavailableError(
          new Error(`Public teams page request failed with ${status}`),
        ),
      ).toBe(true);
    },
  );

  it("does not hide unrelated programming errors", () => {
    expect(
      isUpstreamSourceUnavailableError(
        new TypeError("Cannot read properties of undefined"),
      ),
    ).toBe(false);
  });
});
