import type { Job } from "./types";
type Timing = NonNullable<Job["chunks"][number]["wordTimings"]>[number];

/** Never substitute a sentence for a missing word. Bridge tiny alignment gaps. */
export function spokenWord(
  timings: Timing[] | undefined,
  time: number,
): Timing | null {
  if (!timings?.length) return null;
  let low = 0,
    high = timings.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (timings[middle].startSeconds <= time) low = middle + 1;
    else high = middle;
  }
  const index = low - 1,
    word = timings[index];
  if (!word || /\s/.test(word.text.trim())) return null;
  const next = timings[index + 1];
  const end =
    next && next.startSeconds - word.endSeconds <= 0.12
      ? next.startSeconds
      : word.endSeconds;
  return time < end && word.sourceEnd > word.sourceStart ? word : null;
}
