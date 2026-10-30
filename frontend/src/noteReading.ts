import type { ReadingRange } from "./speechText";

/** Index positioned note runs once per rendered note. Word ticks then visit
 * only the intersecting runs, without scanning the document or changing DOM. */
export function noteReadingRanges() {
  const cache = new Map<string, HTMLElement[]>();
  return (canvas: HTMLElement, note: NonNullable<ReadingRange["note"]>) => {
    let runs = cache.get(note.id);
    if (!runs?.length || !runs[0].isConnected || !runs.at(-1)!.isConnected) {
      runs = [
        ...canvas.querySelectorAll<HTMLElement>(
          `[data-note-fragment="${CSS.escape(note.id)}"] [data-note-from]`,
        ),
      ];
      if (cache.size >= 16) cache.delete(cache.keys().next().value!);
      cache.set(note.id, runs);
    }
    let low = 0,
      high = runs.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (Number(runs[mid].dataset.noteTo) <= note.start) low = mid + 1;
      else high = mid;
    }
    const ranges: Range[] = [];
    for (
      let at = low;
      at < runs.length && Number(runs[at].dataset.noteFrom) < note.end;
      at++
    ) {
      const run = runs[at],
        text = run.firstChild;
      if (!text || text.nodeType !== Node.TEXT_NODE) continue;
      const from = Number(run.dataset.noteFrom),
        to = Number(run.dataset.noteTo),
        range = document.createRange();
      range.setStart(text, Math.max(from, note.start) - from);
      range.setEnd(text, Math.min(to, note.end) - from);
      ranges.push(range);
    }
    return ranges;
  };
}
