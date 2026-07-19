export type ShutdownCoordinator = {
  readonly signal: AbortSignal;
  readonly requested: boolean;
  request(reason?: unknown): void;
  wait(delayMs: number): Promise<void>;
};

export function createShutdownCoordinator(): ShutdownCoordinator {
  const controller = new AbortController();

  return {
    get signal() {
      return controller.signal;
    },
    get requested() {
      return controller.signal.aborted;
    },
    request(reason?: unknown) {
      if (!controller.signal.aborted) controller.abort(reason);
    },
    async wait(delayMs: number) {
      if (controller.signal.aborted || delayMs <= 0) return;

      await new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = () => {
          if (timer) clearTimeout(timer);
          controller.signal.removeEventListener("abort", finish);
          resolve();
        };

        timer = setTimeout(finish, delayMs);
        controller.signal.addEventListener("abort", finish, { once: true });
      });
    },
  };
}

export function requestSignal(options: {
  shutdownSignal: AbortSignal;
  requestSignal?: AbortSignal | null;
  timeoutMs: number;
}) {
  const controller = new AbortController();
  const sources = [options.shutdownSignal, options.requestSignal].filter(
    (signal): signal is AbortSignal => Boolean(signal),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;

  const abortFrom = (source: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(source.reason);
  };
  const listeners = sources.map((source) => {
    const listener = () => abortFrom(source);
    if (source.aborted) abortFrom(source);
    else source.addEventListener("abort", listener, { once: true });
    return { source, listener };
  });

  if (!controller.signal.aborted && options.timeoutMs > 0) {
    timer = setTimeout(
      () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
      options.timeoutMs,
    );
  }

  return {
    signal: controller.signal,
    cleanup() {
      if (timer) clearTimeout(timer);
      for (const { source, listener } of listeners) {
        source.removeEventListener("abort", listener);
      }
    },
  };
}
