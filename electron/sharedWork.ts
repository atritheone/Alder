/** One bounded owner per immutable key; cancellation releases a consumer lease. */
export class SharedWork<T> {
  private entries = new Map<
    string,
    {
      controller: AbortController;
      users: number;
      work: Promise<T>;
      bytes: number;
      done: boolean;
      at: number;
    }
  >();
  constructor(
    private maximumBytes: number,
    private maximumEntries: number,
    private ttl: number,
    private size: (value: T) => number,
    private clone: (value: T) => T,
  ) {}
  run(
    key: string,
    build: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    for (const [id, value] of this.entries)
      if (value.done && Date.now() - value.at > this.ttl)
        this.entries.delete(id);
    let entry = this.entries.get(key);
    if (!entry) {
      // Never add another unbounded queue of distinct in-flight snapshots.
      if (
        [...this.entries.values()].filter((e) => !e.done).length >=
        this.maximumEntries
      )
        return Promise.reject(
          Error(
            "Finish or cancel the current publication before starting more.",
          ),
        );
      entry = {
        controller: new AbortController(),
        users: 0,
        work: undefined!,
        bytes: 0,
        done: false,
        at: Date.now(),
      };
      const owned = entry;
      entry.work = Promise.resolve()
        .then(() => build(owned.controller.signal))
        .then(
          (value) => {
            owned.controller.signal.throwIfAborted();
            owned.done = true;
            owned.at = Date.now();
            owned.bytes = this.size(value);
            this.trim();
            return value;
          },
          (error) => {
            if (this.entries.get(key) === owned) this.entries.delete(key);
            throw error;
          },
        );
      // The final consumer may leave before the underlying cancellation settles.
      void entry.work.catch(() => {});
      this.entries.set(key, entry);
    }
    const owned = entry;
    owned.users++;
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (error: unknown, value?: T) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", abort);
        owned.users--;
        if (!owned.users && !owned.done) {
          owned.controller.abort();
          if (this.entries.get(key) === owned) this.entries.delete(key);
        }
        if (error) reject(error);
        else resolve(this.clone(value!));
      };
      const abort = () =>
        finish(signal?.reason || new DOMException("Cancelled", "AbortError"));
      signal?.addEventListener("abort", abort, { once: true });
      owned.work.then(
        (value) => finish(undefined, value),
        (error) => finish(error),
      );
    });
  }
  private trim() {
    let bytes = [...this.entries.values()].reduce((sum, e) => sum + e.bytes, 0);
    for (const [key, entry] of this.entries) {
      if (
        bytes <= this.maximumBytes &&
        this.entries.size <= this.maximumEntries
      )
        break;
      if (entry.done) {
        this.entries.delete(key);
        bytes -= entry.bytes;
      }
    }
  }
}
