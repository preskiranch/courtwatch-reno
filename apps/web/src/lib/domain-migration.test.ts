import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyIncomingDomainMigration,
  buildLegacyDomainMigrationUrl,
  isLegacyMigrationHost,
} from "./domain-migration";

describe("domain migration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("moves device-scoped saved teams and settings from the old Render host", () => {
    stubBrowserWindow("https://courtwatch-reno-web.onrender.com/", {
      "courtwatch:presence-client-id": "device-123",
      "courtwatch-reno:selected-event-id": "255539",
      "courtwatch:points-division-compare:device-123": JSON.stringify([
        "boys-4th-level-2-green",
      ]),
      "courtwatch-aau:v1:followed-teams:device-123:255539": JSON.stringify({
        teams: [{ id: "team-splash-10u" }],
      }),
    });

    expect(isLegacyMigrationHost()).toBe(true);
    const target = buildLegacyDomainMigrationUrl();
    expect(
      target.startsWith("https://www.courtwatchaau.com/#cw-migrate="),
    ).toBe(true);

    const migratedUrl = new URL(target);
    const nextWindow = stubBrowserWindow(migratedUrl.toString(), {});

    expect(applyIncomingDomainMigration()).toBe(true);
    expect(nextWindow.location.href).toBe("https://www.courtwatchaau.com/");
    expect(
      nextWindow.localStorage.getItem("courtwatch:presence-client-id"),
    ).toBe("device-123");
    expect(
      nextWindow.localStorage.getItem("courtwatch-reno:selected-event-id"),
    ).toBe("255539");
    expect(
      nextWindow.localStorage.getItem(
        "courtwatch:points-division-compare:device-123",
      ),
    ).toContain("boys-4th-level-2-green");
    expect(
      nextWindow.localStorage.getItem(
        "courtwatch:dashboard-follow-migration:device-123",
      ),
    ).toContain("team-splash-10u");
  });
});

function stubBrowserWindow(
  urlString: string,
  initialStorage: Record<string, string>,
) {
  let currentUrl = new URL(urlString);
  const storage = new Map(Object.entries(initialStorage));
  const fakeWindow = {
    get location() {
      return {
        get href() {
          return currentUrl.toString();
        },
        get hostname() {
          return currentUrl.hostname;
        },
        get pathname() {
          return currentUrl.pathname;
        },
        get search() {
          return currentUrl.search;
        },
        get hash() {
          return currentUrl.hash;
        },
      };
    },
    history: {
      state: null,
      replaceState: (_state: unknown, _title: string, nextUrl: string) => {
        currentUrl = new URL(nextUrl, currentUrl.origin);
      },
    },
    localStorage: {
      get length() {
        return storage.size;
      },
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
    },
    btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
    atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
  };

  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", { title: "Court Watch AAU" });
  return fakeWindow;
}
