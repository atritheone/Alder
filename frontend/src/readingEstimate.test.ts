import { describe, expect, it } from "vitest";
import {
  countWords,
  estimatedReadingTime,
  indexWords,
} from "./readingEstimate";

describe("reading estimates", () => {
  it("counts the remaining words, including a partially spoken word", () => {
    const text = "One\t two\n\nthree 😀 four";
    const index = indexWords(text);
    expect(countWords(index)).toBe(5);
    expect(countWords(index, text.indexOf("two") + 1)).toBe(4);
    expect(countWords(index, text.indexOf("two") + 3)).toBe(3);
    expect(countWords(index, text.length)).toBe(0);
  });
  it("keeps selection boundaries exclusive, even at words and Unicode characters", () => {
    const text = "First 😀 last";
    const index = indexWords(text);
    expect(countWords(index, 6, 8)).toBe(1);
    expect(countWords(index, 0, 6)).toBe(1);
    expect(countWords(index, 5, 6)).toBe(0);
    expect(countWords(index, 9, 9)).toBe(0);
    expect(countWords(index, 12, 8)).toBe(0);
  });
  it("formats hours and minutes and applies playback speed", () => {
    expect(estimatedReadingTime(0)).toBe("≈\u00a00:00");
    expect(estimatedReadingTime(1)).toBe("≈\u00a00:01");
    expect(estimatedReadingTime(10800)).toBe("≈\u00a01:00");
    expect(estimatedReadingTime(10800, 2)).toBe("≈\u00a00:30");
    expect(estimatedReadingTime(270, 0.5)).toBe("≈\u00a00:03");
  });
});
