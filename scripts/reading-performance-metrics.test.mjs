import { strict as assert } from "node:assert";
import { test } from "node:test";
import { playbackGaps } from "./reading-performance-metrics.mjs";

test("separates authored pauses, startup and controls from section delays", () => {
  const event = (type, at, time = 0, src = "one") => ({ type, at, time, src });
  const result = playbackGaps(
    {
      controlsStarted: 3000,
      events: [
        event("waiting", 0),
        event("playing", 2000),
        event("ended", 2200, 1),
        event("waiting", 2300, 0, "two"),
        event("playing", 2350, 0, "two"),
        event("pause", 3000, 1, "two"),
        event("playing", 4000, 1, "two"),
      ],
    },
    0.18,
    1.5,
  );
  assert.equal(result.transitions, 1);
  assert.equal(result.maximumExcessMilliseconds, 30);
  assert.equal(result.inSectionWaits, 0);
});

test("reports delayed sections and mid-section stalls independently", () => {
  const result = playbackGaps(
    {
      events: [
        { type: "playing", at: 0, time: 0, src: "one" },
        { type: "waiting", at: 100, time: 0.1, src: "one" },
        { type: "playing", at: 600, time: 0.1, src: "one" },
        { type: "ended", at: 1000, time: 1, src: "one" },
        { type: "playing", at: 2000, time: 0, src: "two" },
      ],
    },
    0.2,
    1,
  );
  assert.equal(result.transitionsOver250MillisecondsExcess, 1);
  assert.equal(result.maximumExcessMilliseconds, 800);
  assert.equal(result.inSectionWaits, 1);
  assert.equal(result.maximumInSectionWaitMilliseconds, 500);
});
