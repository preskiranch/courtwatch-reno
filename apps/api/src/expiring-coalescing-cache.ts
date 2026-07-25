type CacheEntry<Value> =
  | {
      state: "loading";
      promise: Promise<Value>;
    }
  | {
      state: "ready";
      expiresAt: number;
      value: Value;
    };

export class ExpiringCoalescingCache<Key, Value> {
  private readonly entries = new Map<Key, CacheEntry<Value>>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isFinite(ttlMs) || ttlMs < 0) {
      throw new Error("Cache TTL must be a finite non-negative number");
    }
  }

  get(key: Key, load: () => Promise<Value>): Promise<Value> {
    const entry = this.entries.get(key);
    if (entry?.state === "loading") return entry.promise;
    if (entry?.state === "ready" && entry.expiresAt > this.now()) {
      return Promise.resolve(entry.value);
    }

    const promise = Promise.resolve()
      .then(load)
      .then(
        (value) => {
          const current = this.entries.get(key);
          if (current?.state === "loading" && current.promise === promise) {
            this.entries.set(key, {
              state: "ready",
              expiresAt: this.now() + this.ttlMs,
              value,
            });
          }
          return value;
        },
        (error) => {
          const current = this.entries.get(key);
          if (current?.state === "loading" && current.promise === promise) {
            this.entries.delete(key);
          }
          throw error;
        },
      );

    this.entries.set(key, { state: "loading", promise });
    return promise;
  }

  delete(key: Key): void {
    this.entries.delete(key);
  }

  deleteWhere(predicate: (key: Key) => boolean): void {
    for (const key of this.entries.keys()) {
      if (predicate(key)) this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
