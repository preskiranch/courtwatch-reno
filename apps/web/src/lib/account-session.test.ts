import { afterEach, describe, expect, it, vi } from "vitest";
import {
  accountSessionIsPersistent,
  clearAccountSession,
  loadAccountSession,
  saveAccountSession,
  type AccountSession,
} from "./account-session";

const session: AccountSession = {
  token: "signed-token",
  user: {
    id: "user-1",
    email: "parent@example.com",
    displayName: "Parent",
    createdAt: "2026-07-16T12:00:00.000Z",
  },
};

describe("account session persistence", () => {
  afterEach(() => {
    clearAccountSession();
    vi.unstubAllGlobals();
  });

  it("persists a normal session", () => {
    const browser = stubBrowserWindow({});

    saveAccountSession(session);

    expect(accountSessionIsPersistent()).toBe(true);
    expect(loadAccountSession()).toEqual(session);
    expect(browser.storage.has("courtwatch-aau:account-session:v1")).toBe(true);
  });

  it("evicts only disposable API caches when storage is full", () => {
    const browser = stubBrowserWindow(
      {
        "courtwatch-aau:v29:events:/api/events": "large-event-cache",
        "courtwatch:dashboard": "legacy-dashboard-cache",
        "courtwatch-aau:v1:followed-teams:device-1:255539": "saved-teams",
        "courtwatch-aau:v1:suppressed-followed:device-1:255539":
          "suppressed-team",
        "courtwatch-aau:account-sync:user-1:device-1": "complete",
        "courtwatch:presence-client-id": "device-1",
        "courtwatch-reno:selected-event-id": "255539",
      },
      { failAccountWrites: 1 },
    );

    saveAccountSession(session);

    expect(accountSessionIsPersistent()).toBe(true);
    expect(loadAccountSession()).toEqual(session);
    expect(browser.storage.has("courtwatch-aau:v29:events:/api/events")).toBe(
      false,
    );
    expect(browser.storage.has("courtwatch:dashboard")).toBe(false);
    expect(
      browser.storage.get("courtwatch-aau:v1:followed-teams:device-1:255539"),
    ).toBe("saved-teams");
    expect(
      browser.storage.get(
        "courtwatch-aau:v1:suppressed-followed:device-1:255539",
      ),
    ).toBe("suppressed-team");
    expect(
      browser.storage.get("courtwatch-aau:account-sync:user-1:device-1"),
    ).toBe("complete");
    expect(browser.storage.get("courtwatch:presence-client-id")).toBe(
      "device-1",
    );
    expect(browser.storage.get("courtwatch-reno:selected-event-id")).toBe(
      "255539",
    );
  });

  it("keeps a successful login in memory when browser storage is blocked", () => {
    stubBrowserWindow({}, { failAccountWrites: Number.POSITIVE_INFINITY });

    saveAccountSession(session);

    expect(accountSessionIsPersistent()).toBe(false);
    expect(loadAccountSession()).toEqual(session);
  });
});

function stubBrowserWindow(
  initialStorage: Record<string, string>,
  options: { failAccountWrites?: number } = {},
) {
  const storage = new Map(Object.entries(initialStorage));
  let remainingFailures = options.failAccountWrites ?? 0;
  const localStorage = {
    get length() {
      return storage.size;
    },
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (
        key === "courtwatch-aau:account-session:v1" &&
        remainingFailures > 0
      ) {
        remainingFailures -= 1;
        throw new DOMException("Storage quota exceeded", "QuotaExceededError");
      }
      storage.set(key, value);
    },
    removeItem: (key: string) => storage.delete(key),
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
  };
  vi.stubGlobal("window", { localStorage });
  return { storage, localStorage };
}
