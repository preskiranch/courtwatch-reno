import { describe, expect, it } from "vitest";
import { compactName, normalizeName, normalizeProgramName } from "./normalization.js";

describe("name normalization", () => {
  it("lowercases names, removes punctuation, and collapses whitespace", () => {
    expect(normalizeName(" Splash-City   Basketball!! ")).toBe("splash city basketball");
  });

  it("removes program suffixes only for program matching", () => {
    expect(normalizeProgramName("Team Arsenal Elite 7th Grade Boys Black")).toBe("arsenal");
  });

  it("compacts SplashCity variants", () => {
    expect(compactName("Splash City")).toBe("splashcity");
  });
});
