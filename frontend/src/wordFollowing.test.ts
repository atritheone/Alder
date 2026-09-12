import { describe, expect, it } from "vitest";
import { spokenWord } from "./wordFollowing";

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
