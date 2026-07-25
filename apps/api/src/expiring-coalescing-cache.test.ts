import { describe, expect, it, vi } from "vitest";
import { ExpiringCoalescingCache } from "./expiring-coalescing-cache.js";

describe("ExpiringCoalescingCache", () => {
  it("shares one loader across overlapping requests and reuses the result", async () => {
    let finish!: (value: string) => void;
    const load = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const cache = new ExpiringCoalescingCache<string, string>(2_000);

    const first = cache.get("event:client", load);
    const second = cache.get("event:client", load);

    expect(first).toBe(second);
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);

    finish("snapshot");
    await expect(first).resolves.toBe("snapshot");
    await expect(cache.get("event:client", load)).resolves.toBe("snapshot");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reloads after expiration", async () => {
    let now = 1_000;
    const load = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");
    const cache = new ExpiringCoalescingCache<string, string>(
      2_000,
      () => now,
    );

    await expect(cache.get("key", load)).resolves.toBe("first");
    now = 3_001;
    await expect(cache.get("key", load)).resolves.toBe("second");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not retain rejected loads", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("database busy"))
      .mockResolvedValueOnce("recovered");
    const cache = new ExpiringCoalescingCache<string, string>(2_000);

    await expect(cache.get("key", load)).rejects.toThrow("database busy");
    await expect(cache.get("key", load)).resolves.toBe("recovered");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("supports targeted invalidation", async () => {
    const cache = new ExpiringCoalescingCache<string, string>(2_000);

    await cache.get("one:client", async () => "one");
    await cache.get("two:client", async () => "two");
    cache.deleteWhere((key) => key.startsWith("one:"));

    const reloadOne = vi.fn(async () => "one-new");
    const reloadTwo = vi.fn(async () => "two-new");
    await expect(cache.get("one:client", reloadOne)).resolves.toBe("one-new");
    await expect(cache.get("two:client", reloadTwo)).resolves.toBe("two");
    expect(reloadOne).toHaveBeenCalledOnce();
    expect(reloadTwo).not.toHaveBeenCalled();
  });

  it("does not let an invalidated older load overwrite a newer load", async () => {
    let finishFirst!: (value: string) => void;
    const cache = new ExpiringCoalescingCache<string, string>(2_000);
    const first = cache.get(
      "key",
      () =>
        new Promise<string>((resolve) => {
          finishFirst = resolve;
        }),
    );
    await Promise.resolve();

    cache.delete("key");
    await expect(cache.get("key", async () => "new")).resolves.toBe("new");
    finishFirst("old");
    await expect(first).resolves.toBe("old");

    await expect(cache.get("key", async () => "unexpected")).resolves.toBe(
      "new",
    );
  });
});
