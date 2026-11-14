import type { Chapter } from "./types";
import { words } from "./api";
import { countSentences } from "./textCounts";
import { indexWords } from "./readingEstimate";
const cache = new WeakMap<Chapter, { text: string; words: number; sentences: number; index?: ReturnType<typeof indexWords> }>();
export function chapterStats(chapter: Chapter, indexed = false) {
  let value = cache.get(chapter);
  if (!value || value.text !== chapter.text) {
    value = { text: chapter.text, words: words(chapter.text), sentences: countSentences(chapter.text) };
    cache.set(chapter, value);
  }
  if (indexed && !value.index) value.index = indexWords(chapter.text);
  return value;
}
