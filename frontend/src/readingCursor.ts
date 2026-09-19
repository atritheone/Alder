import type { SpeechChunk } from "./types";

export type ReadingPosition = {
  chapterId: string;
  offset: number;
  length: number;
};

export function readingPosition(
  chunk: SpeechChunk,
  seconds: number,
  source: {
    id: string;
    text: string;
    base: number;
    offset: number;
    offsets: number[];
  },
): ReadingPosition {
  const index = Math.max(
    0,
    Math.min(
      source.offsets.length - 1,
      readingCursorOffset(chunk, seconds) - source.offset,
    ),
  );
  return {
    chapterId: source.id,
    offset: Math.min(
      source.text.length,
      source.base + (source.offsets[index] || 0),
    ),
    length: source.text.length,
  };
}

/** Source code-point offset at which paused speech can continue. */
export function readingCursorOffset(
  chunk: SpeechChunk,
  seconds: number,
): number {
  const start = chunk.sourceStart || 0;
  // In a gap, choose the next word; midway through a word, keep its start.
  const words = chunk.wordTimings || [];
  let low = 0,
    high = words.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (words[middle].endSeconds <= seconds) low = middle + 1;
    else high = middle;
  }
  const word = words[low];
  if (word) return start + word.sourceStart;
  if (
    chunk.wordTimings?.length ||
    (chunk.seconds !== undefined && seconds >= chunk.seconds)
  )
    return chunk.sourceEnd ?? start + Array.from(chunk.text).length;
  // Without alignment, the start of this passage is the last reliable position.
  return start;
}
