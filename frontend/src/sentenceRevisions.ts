import type { Annotation } from "./types";

export function sentenceRange(text: string, position: number) {
  const start = text.lastIndexOf("\n", Math.max(0, position - 1)) + 1;
  const lineEnd = text.indexOf("\n", position);
  const end = lineEnd < 0 ? text.length : lineEnd;
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  for (const segment of segmenter.segment(text.slice(start, end))) {
    const from = start + segment.index;
    const to = from + segment.segment.trimEnd().length;
    if (position <= from + segment.segment.length)
      return { start: from, end: to };
  }
  return { start, end };
}

/** Preserve only suggestions whose entire paragraph context still matches. */
export function rebaseRevisions(
  items: Annotation[],
  previous: string,
  current: string,
  previousLanguages = "[]",
  currentLanguages = "[]",
) {
  const languagesAt = (encoded: string, start: number, end: number) =>
    JSON.stringify(
      (
        JSON.parse(encoded) as {
          start: number;
          end: number;
          language: string;
        }[]
      )
        .filter((row) => row.start < end && row.end > start)
        .map((row) => row.language),
    );
  if (previous === current && previousLanguages === currentLanguages)
    return items;
  return items.flatMap((item) => {
    const start = previous.lastIndexOf("\n", item.start - 1) + 1;
    const next = previous.indexOf("\n", item.end);
    const end = next < 0 ? previous.length : next;
    const paragraph = previous.slice(start, end);
    const positions: number[] = [];
    let at = current.indexOf(paragraph);
    while (paragraph && at >= 0) {
      if (
        (at === 0 || current[at - 1] === "\n") &&
        (at + paragraph.length === current.length ||
          current[at + paragraph.length] === "\n")
      )
        positions.push(at);
      at = current.indexOf(paragraph, at + 1);
    }
    if (positions.length !== 1) return [];
    const delta = positions[0] - start;
    if (
      languagesAt(previousLanguages, item.start, item.end) !==
      languagesAt(currentLanguages, item.start + delta, item.end + delta)
    )
      return [];
    return [
      {
        ...item,
        start: item.start + delta,
        end: item.end + delta,
        alternatives: item.alternatives?.map((alternative) => ({
          ...alternative,
          edits: alternative.edits.map((edit) => ({
            ...edit,
            start: edit.start + delta,
            end: edit.end + delta,
          })),
        })),
      },
    ];
  });
}
