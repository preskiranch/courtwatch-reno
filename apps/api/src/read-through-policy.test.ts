import { describe, expect, it } from "vitest";
import { apiReadThroughSourceEnabled } from "./read-through-policy.js";

describe("API source read-through policy", () => {
  it("keeps production reads independent from the upstream provider", () => {
    expect(apiReadThroughSourceEnabled({ NODE_ENV: "production" })).toBe(false);
  });

  it("allows local development hydration by default", () => {
    expect(apiReadThroughSourceEnabled({ NODE_ENV: "development" })).toBe(
      true,
    );
  });

  it("honors an explicit override", () => {
    expect(
      apiReadThroughSourceEnabled({
        API_READ_THROUGH_SOURCE: "true",
        NODE_ENV: "production",
      }),
    ).toBe(true);
  });
});
