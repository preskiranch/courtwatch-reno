import { describe, expect, it } from "vitest";
import { notificationHash } from "./notification.js";
import { seedChangeEvents } from "./seed-data.js";

describe("notification deduplication", () => {
  it("uses stable hashes for the same event/user/channel", () => {
    const first = notificationHash(seedChangeEvents[0]!, "user-1", "web_push");
    const second = notificationHash(seedChangeEvents[0]!, "user-1", "web_push");
    expect(first).toBe(second);
  });

  it("separates channels and users", () => {
    expect(notificationHash(seedChangeEvents[0]!, "user-1", "web_push")).not.toBe(notificationHash(seedChangeEvents[0]!, "user-2", "web_push"));
    expect(notificationHash(seedChangeEvents[0]!, "user-1", "web_push")).not.toBe(notificationHash(seedChangeEvents[0]!, "user-1", "expo"));
  });
});
