import type { SpeechChunk } from "./types";

/** Source code-point offset at which paused speech can continue. */
export function readingCursorOffset(
  chunk: SpeechChunk,
  seconds: number,
): number {
  const start = chunk.sourceStart || 0;
  // In a gap, choose the next word; midway through a word, keep its start.
  const word = chunk.wordTimings?.find((word) => seconds < word.endSeconds);
  if (word) return start + word.sourceStart;
  if (
    chunk.wordTimings?.length ||
    (chunk.seconds !== undefined && seconds >= chunk.seconds)
  )
    return chunk.sourceEnd ?? start + Array.from(chunk.text).length;
  // Without alignment, the start of this passage is the last reliable position.
  return start;
}
