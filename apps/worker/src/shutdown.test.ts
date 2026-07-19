import { describe, expect, it, vi } from "vitest";
import {
  createShutdownCoordinator,
  requestSignal,
} from "./shutdown.js";

describe("worker shutdown coordination", () => {
  it("interrupts a pending wait when shutdown is requested", async () => {
    vi.useFakeTimers();
    const shutdown = createShutdownCoordinator();
    const wait = shutdown.wait(60_000);

    shutdown.request("deploy");
    await wait;

    expect(shutdown.requested).toBe(true);
    expect(shutdown.signal.reason).toBe("deploy");
    vi.useRealTimers();
  });

  it("aborts in-flight requests when shutdown is requested", () => {
    const shutdown = createShutdownCoordinator();
    const request = requestSignal({
      shutdownSignal: shutdown.signal,
      timeoutMs: 30_000,
    });

    shutdown.request("deploy");

    expect(request.signal.aborted).toBe(true);
    expect(request.signal.reason).toBe("deploy");
    request.cleanup();
  });

  it("preserves a caller-provided abort signal", () => {
    const shutdown = createShutdownCoordinator();
    const caller = new AbortController();
    const request = requestSignal({
      shutdownSignal: shutdown.signal,
      requestSignal: caller.signal,
      timeoutMs: 30_000,
    });

    caller.abort("caller cancelled");

    expect(request.signal.aborted).toBe(true);
    expect(request.signal.reason).toBe("caller cancelled");
    request.cleanup();
  });
});
