import { expect, it, vi } from "vitest";
import { slicedJob } from "./slicedJob";
it("publishes only a current completed epoch and cancels an abandoned continuation", () => {
  let current = true;
  const frames: (() => void)[] = [],
    done = vi.fn();
  let released = 0;
  function* work() {
    try {
      yield;
      yield;
      return 7;
    } finally {
      released++;
    }
  }
  const job = slicedJob(work(), {
    current: () => current,
    complete: done,
    error: () => {},
    schedule: (fn) => (frames.push(fn), frames.length),
    unschedule: () => {},
  });
  job.start();
  expect(done).not.toHaveBeenCalled();
  frames.shift()!();
  current = false;
  frames.shift()!();
  expect(done).not.toHaveBeenCalled();
  expect(released).toBe(1);
  expect(job.pending).toBe(false);
});
it("drains before a command requiring exact geometry and reports failures without publishing", () => {
  const frames: (() => void)[] = [],
    done = vi.fn(),
    error = vi.fn();
  function* work() {
    yield;
    yield;
    return 9;
  }
  const options = {
    current: () => true,
    complete: done,
    error,
    schedule: (fn: () => void) => (frames.push(fn), frames.length),
    unschedule: () => {},
  };
  const job = slicedJob(work(), options);
  job.start();
  expect(job.finish()).toBe(true);
  expect(done).toHaveBeenCalledWith(9);
  function* broken(): Generator<void, number, void> {
    yield;
    throw Error("failure");
  }
  const failed = slicedJob(broken(), options);
  failed.start();
  failed.finish();
  expect(error).toHaveBeenCalledOnce();
  expect(done).toHaveBeenCalledTimes(1);
});
