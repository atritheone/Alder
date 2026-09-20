const sentences = new Intl.Segmenter(undefined, { granularity: "sentence" });

export function countSentences(text: string) {
  let count = 0;
  for (const { segment } of sentences.segment(text)) {
    if (segment.trim()) count++;
  }
  return count;
}
