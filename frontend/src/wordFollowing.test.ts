import { describe, expect, it } from "vitest";
import { nextWordDelay, spokenWord } from "./wordFollowing";

const timings = [
  {
    text: "one",
    sourceStart: 0,
    sourceEnd: 3,
    startSeconds: 0.1,
    endSeconds: 0.4,
  },
  {
    text: "two",
    sourceStart: 4,
    sourceEnd: 7,
    startSeconds: 0.45,
    endSeconds: 0.7,
  },
  {
    text: "three",
    sourceStart: 8,
    sourceEnd: 13,
    startSeconds: 1,
    endSeconds: 1.3,
  },
];
describe("spoken word following", () => {
  it("bridges tiny timestamp gaps using only the preceding word", () => {
    expect(spokenWord(timings, 0.42)?.text).toBe("one");
    expect(spokenWord(timings, 0.45)?.text).toBe("two");
  });
  it("does not highlight sentences, silence, or passages without timing", () => {
    for (const time of [0, 0.8, 1.3, 10])
      expect(spokenWord(timings, time)).toBeNull();
    expect(spokenWord(undefined, 1)).toBeNull();
    expect(spokenWord([], 1)).toBeNull();
  });
  it("supports seeking backwards and exact boundaries", () => {
    expect(spokenWord(timings, 1.1)?.sourceStart).toBe(8);
    expect(spokenWord(timings, 0.1)?.sourceStart).toBe(0);
  });
});

describe("word boundary scheduling", () => {
  it("wakes for short words at high speed instead of waiting a full frame", () => {
    const short = Array.from({ length: 10 }, (_, i) => ({
      text: `w${i}`,
      sourceStart: i * 3,
      sourceEnd: i * 3 + 2,
      startSeconds: i * 0.02,
      endSeconds: (i + 1) * 0.02,
    }));
    for (let i = 0; i < short.length; i++) {
      expect(spokenWord(short, i * 0.02 + 0.001)?.text).toBe(`w${i}`);
      expect(nextWordDelay(short, i * 0.02 + 0.001, 4)).toBeCloseTo(4.75);
    }
  });
  it("handles silence, missing timings and backwards seeks", () => {
    expect(nextWordDelay(undefined, 0, 4)).toBe(16);
    expect(nextWordDelay(timings, 0.448, 2)).toBeCloseTo(1);
    expect(nextWordDelay(timings, 2, 4)).toBe(16);
    expect(nextWordDelay(timings, 0.099, 1)).toBeCloseTo(1);
  });
});
