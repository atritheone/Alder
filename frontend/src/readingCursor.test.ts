import { describe, expect, it } from "vitest";
import { readingCursorOffset, readingPosition } from "./readingCursor";
import { codePointOffsets } from "./useSpeechJob";
import type { SpeechChunk } from "./types";
const chunk: SpeechChunk = {
  id: "chunk",
  status: "ready",
  text: "🌲 I   write",
  sourceStart: 12,
  sourceEnd: 23,
  seconds: 2,
  wordTimings: [
    {
      text: "I",
      sourceStart: 2,
      sourceEnd: 3,
      startSeconds: 0.1,
      endSeconds: 0.5,
    },
    {
      text: "write",
      sourceStart: 6,
      sourceEnd: 11,
      startSeconds: 0.8,
      endSeconds: 1.8,
    },
  ],
};
describe("reading cursor", () => {
  it("reports full-document positions when reading starts partway through Unicode text", () => {
    const text = "Earlier text. 🌲 I   write";
    const base = "Earlier text. ".length;
    const source = {
      id: "chapter",
      text,
      base,
      offset: 12,
      offsets: codePointOffsets(text.slice(base)),
    };
    expect(readingPosition(chunk, 1, source)).toEqual({
      chapterId: "chapter",
      offset: text.indexOf("write"),
      length: text.length,
    });
    expect(readingPosition(chunk, 2, source).offset).toBe(text.length);
  });
  it("keeps a partially spoken word and advances to the next word in a gap", () => {
    expect(readingCursorOffset(chunk, 0.3)).toBe(14);
    expect(readingCursorOffset(chunk, 0.6)).toBe(18);
    expect(readingCursorOffset(chunk, 1)).toBe(18);
  });
  it("reaches the end of a completed passage without losing its source offset", () => {
    expect(readingCursorOffset(chunk, 2)).toBe(23);
  });
  it("uses a reliable passage boundary if word timing is unavailable", () => {
    expect(readingCursorOffset({ ...chunk, wordTimings: undefined }, 1)).toBe(
      12,
    );
    expect(readingCursorOffset({ ...chunk, wordTimings: undefined }, 2)).toBe(
      23,
    );
  });
});
