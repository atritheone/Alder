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

/** Wake at the next audio boundary; a short watchdog handles seeks/clock drift. */
export function nextWordDelay(
  timings: Timing[] | undefined,
  time: number,
  speed: number,
): number {
  if (!timings?.length) return 16;
  let low = 0,
    high = timings.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (timings[mid].startSeconds <= time) low = mid + 1;
    else high = mid;
  }
  const start = timings[low]?.startSeconds ?? Infinity;
  const end = timings[low - 1]?.endSeconds ?? Infinity;
  const boundary = Math.min(start, end > time ? end : Infinity);
  return Math.max(
    1,
    Math.min(16, ((boundary - time) * 1000) / Math.max(0.1, speed)),
  );
}
