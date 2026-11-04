import {
  countWords,
  estimatedReadingTime,
  type indexWords,
} from "./readingEstimate";
import type { ReadingPosition } from "./readingCursor";

type Selection = {
  chapterId: string;
  words: number;
  start: number;
  end: number;
};
export type ReadingStatusContext = {
  chapterIds: string[];
  wordIndexes: ReturnType<typeof indexWords>[];
  selection: Selection | null;
  playing: boolean;
  raw: boolean;
  speed: number;
};

export function readingStatus(
  position: ReadingPosition | null,
  context: ReadingStatusContext,
) {
  const { wordIndexes, selection } = context;
  const index = context.chapterIds.indexOf(position?.chapterId || "");
  const remaining = context.playing && !!position && index >= 0 && !context.raw;
  let words =
    selection?.words ??
    wordIndexes.reduce((sum, value) => sum + value.length, 0);
  if (remaining && position) {
    if (selection) {
      if (selection.chapterId === position.chapterId)
        words = countWords(
          wordIndexes[index],
          Math.max(selection.start, position.offset),
          selection.end,
        );
    } else
      words =
        countWords(wordIndexes[index], position.offset) +
        wordIndexes
          .slice(index + 1)
          .reduce((sum, value) => sum + value.length, 0);
  }
  return {
    remaining,
    estimate: estimatedReadingTime(words, context.speed),
    progress:
      Math.max(
        0,
        Math.min(
          100,
          position?.length ? (100 * position.offset) / position.length : 0,
        ),
      ).toFixed(0) + "%",
  };
}

/** The precise position lives outside React. Repaint the status only when a
 * displayed value changes, including a newly narrated page or note page. */
export function readingStatusKey(
  position: ReadingPosition | null,
  context: ReadingStatusContext,
  page: number | null,
) {
  const status = readingStatus(position, context);
  return JSON.stringify([
    position?.chapterId ?? null,
    status.remaining,
    status.estimate,
    status.progress,
    page,
  ]);
}
