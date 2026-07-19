import { describe, expect, it } from "vitest";
import { RequestControllerRegistry } from "./request-registry.js";

describe("RequestControllerRegistry", () => {
  it("tracks and releases active controllers", () => {
    const registry = new RequestControllerRegistry();
    const request = registry.create();

    expect(registry.size).toBe(1);
    request.release();
    request.release();

    expect(registry.size).toBe(0);
  });

  it("aborts all active controllers during shutdown", () => {
    const registry = new RequestControllerRegistry();
    const first = registry.create();
    const second = registry.create();

    registry.abortAll("service shutdown");

    expect(first.controller.signal.aborted).toBe(true);
    expect(first.controller.signal.reason).toBe("service shutdown");
    expect(second.controller.signal.aborted).toBe(true);
  });
});
