import { describe, expect, it, vi } from "vitest";
import {
  assertContentLengthWithinLimit,
  PayloadLimitError,
  readAsyncBodyWithLimit,
  readWebBodyWithLimit,
} from "./body-limits.js";

describe("relay body limits", () => {
  it("reads request chunks up to the configured limit", async () => {
    async function* body() {
      yield Buffer.from("court");
      yield Buffer.from("watch");
    }

    await expect(
      readAsyncBodyWithLimit(body(), 10, "request"),
    ).resolves.toEqual(Buffer.from("courtwatch"));
  });

  it("rejects a request as soon as its body exceeds the limit", async () => {
    async function* body() {
      yield Buffer.from("1234");
      yield Buffer.from("56");
    }

    await expect(
      readAsyncBodyWithLimit(body(), 5, "request"),
    ).rejects.toMatchObject({
      direction: "request",
      maxBytes: 5,
    });
  });

  it("cancels an oversized upstream response", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
      },
      cancel,
    });

    await expect(readWebBodyWithLimit(stream, 5)).rejects.toBeInstanceOf(
      PayloadLimitError,
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects an oversized declared content length before buffering", () => {
    expect(() =>
      assertContentLengthWithinLimit("1001", 1_000, "response"),
    ).toThrow(PayloadLimitError);
    expect(() =>
      assertContentLengthWithinLimit("1000", 1_000, "response"),
    ).not.toThrow();
  });
});
