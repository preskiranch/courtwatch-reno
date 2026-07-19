import { describe, expect, it, vi } from "vitest";
import { CoalescedTask } from "./coalesced-task.js";

describe("CoalescedTask", () => {
  it("coalesces overlapping executions", async () => {
    let finish!: () => void;
    const operation = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const task = new CoalescedTask(operation);

    const first = task.run();
    const second = task.run();

    expect(first).toBe(second);
    await Promise.resolve();
    expect(operation).toHaveBeenCalledTimes(1);
    expect(task.running).toBe(true);

    finish();
    await task.drain();
    expect(task.running).toBe(false);
  });

  it("allows a new execution after the prior run settles", async () => {
    const operation = vi.fn(async () => undefined);
    const task = new CoalescedTask(operation);

    await task.run();
    await task.run();

    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("drains and resets after a failed execution", async () => {
    const operation = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("delivery failed"))
      .mockResolvedValueOnce(undefined);
    const task = new CoalescedTask(operation);

    await expect(task.run()).rejects.toThrow("delivery failed");
    expect(task.running).toBe(false);
    await expect(task.run()).resolves.toBeUndefined();
  });
});
