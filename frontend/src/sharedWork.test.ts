import { it, expect, vi } from "vitest";
import { SharedWork } from "../../electron/sharedWork";
const cache = () =>
  new SharedWork<{ text: string }>(
    50,
    2,
    1000,
    (x) => x.text.length,
    structuredClone,
  );
it("shares exact work, separates consumer cancellation and clones results", async () => {
  const pool = cache(),
    one = new AbortController();
  let release!: (x: { text: string }) => void;
  const build = vi.fn(
    (signal) =>
      new Promise<{ text: string }>((resolve) => {
        release = resolve;
        expect(signal.aborted).toBe(false);
      }),
  );
  const first = pool.run("same", build, one.signal),
    second = pool.run("same", build);
  const cancelled = expect(first).rejects.toThrow();
  one.abort();
  await cancelled;
  await Promise.resolve();
  release({ text: "result" });
  const value = await second;
  value.text = "changed";
  expect((await pool.run("same", build)).text).toBe("result");
  expect(build).toHaveBeenCalledTimes(1);
});
it("aborts abandoned work, rejects overflow and never caches failure or oversized results", async () => {
  const pool = cache();
  const signal = new AbortController();
  let owned!: AbortSignal;
  const pending = pool.run(
    "one",
    async (s) => {
      owned = s;
      await new Promise((r) => s.addEventListener("abort", r, { once: true }));
      s.throwIfAborted();
      return { text: "unused" };
    },
    signal.signal,
  );
  await Promise.resolve();
  const failed = expect(pending).rejects.toThrow();
  signal.abort();
  await failed;
  expect(owned.aborted).toBe(true);
  const build = vi.fn(async () => ({ text: "x".repeat(100) }));
  await pool.run("one", build);
  await pool.run("one", build);
  expect(build).toHaveBeenCalledTimes(2);
  await expect(
    pool.run("fail", async () => {
      throw Error("failed");
    }),
  ).rejects.toThrow("failed");
  expect(await pool.run("fail", async () => ({ text: "recovered" }))).toEqual({
    text: "recovered",
  });
});
