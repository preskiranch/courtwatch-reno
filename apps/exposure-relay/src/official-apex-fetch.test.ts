import { describe, expect, it } from "vitest";
import { officialApexRequestOptions } from "./official-apex-fetch.js";

describe("officialApexRequestOptions", () => {
  it("preserves the basketball path while routing with its virtual host", () => {
    const options = officialApexRequestOptions(
      new URL(
        "https://basketball.exposureevents.com/255539/event/teams?division=9u",
      ),
      {
        headers: {
          Accept: "text/html",
          Host: "caller-controlled.example",
        },
        method: "GET",
      },
      "basketball.exposureevents.com",
    );

    expect(options).toMatchObject({
      headers: {
        accept: "text/html",
        host: "basketball.exposureevents.com",
      },
      method: "GET",
      path: "/255539/event/teams?division=9u",
    });
  });

  it("rejects a target hostname that could alter the request authority", () => {
    expect(() =>
      officialApexRequestOptions(
        new URL("https://basketball.exposureevents.com/robots.txt"),
        { method: "GET" },
        "exposureevents.com:443/path",
      ),
    ).toThrow("Official target hostname is invalid.");
  });
});
