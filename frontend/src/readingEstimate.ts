/** Index once per text edit; playback counts use binary searches, not rescans. */
export function indexWords(text: string) {
  return Array.from(text.matchAll(/\S+/gu), (match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

export function countWords(
  index: ReturnType<typeof indexWords>,
  start = 0,
  end = Infinity,
) {
  if (end <= start) return 0;
  const boundary = (predicate: (word: (typeof index)[number]) => boolean) => {
    let low = 0,
      high = index.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (predicate(index[mid])) low = mid + 1;
      else high = mid;
    }
    return low;
  };
  return Math.max(
    0,
    boundary((word) => word.start < end) -
      boundary((word) => word.end <= start),
  );
}

export function estimatedReadingTime(wordCount: number, speed = 1) {
  const minutes = Math.ceil(Math.max(0, wordCount) / (180 * speed));
  return `≈\u00a0${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}
