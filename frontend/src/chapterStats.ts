import type { Chapter } from "./types";
import { words } from "./api";
import { countSentences } from "./textCounts";
import { indexWords } from "./readingEstimate";
const cache = new WeakMap<Chapter, { text: string; words: number; sentences: number; index?: ReturnType<typeof indexWords> }>();
export function chapterStats(chapter: Chapter, indexed = false) {
  let value = cache.get(chapter);
  if (!value || value.text !== chapter.text) {
    const index = indexed ? indexWords(chapter.text) : undefined;
    value = { text: chapter.text, words: index ? index.length : words(chapter.text), sentences: countSentences(chapter.text), index };
    cache.set(chapter, value);
  }
  if (indexed && !value.index) value.index = indexWords(chapter.text);
  return value;
}
