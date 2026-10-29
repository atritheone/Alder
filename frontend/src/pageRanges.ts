/** Physical pages may own disjoint document intervals (parallel table cells).
 * from/to remain an envelope for layout invalidation, never an editing range
 * when fragments are present. Intervals are half-open UTF-16/ProseMirror ranges.
 */
export type PageRange = { from: number; to: number };
export type RangedPage = PageRange & { fragments?: readonly PageRange[] };
type Entry = PageRange & { page: number };
const indexes = new WeakMap<readonly RangedPage[], Entry[] | null>();

export function pageRanges(page: RangedPage): readonly PageRange[] {
  return page.fragments ?? [page];
}
export function contiguousPage(page: RangedPage) {
  return (
    !page.fragments ||
    (page.fragments.length === 1 &&
      page.fragments[0].from === page.from &&
      page.fragments[0].to === page.to)
  );
}
function index(pages: readonly RangedPage[]) {
  if (indexes.has(pages)) return indexes.get(pages)!;
  const entries = pages.some((page) => page.fragments)
    ? pages
        .flatMap((page, i) =>
          pageRanges(page)
            .filter((range) => range.to > range.from)
            .map((range) => ({ ...range, page: i })),
        )
        .sort((a, b) => a.from - b.from || a.to - b.to)
    : null;
  indexes.set(pages, entries);
  return entries;
}
function preceding(entries: readonly PageRange[], position: number) {
  let low = 0,
    high = entries.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (entries[middle].from <= position) low = middle;
    else high = middle - 1;
  }
  return low;
}
export function physicalPageAtPosition(
  pages: readonly RangedPage[],
  position: number,
): number | null {
  if (!pages.length) return null;
  const entries = index(pages);
  return entries?.length
    ? entries[preceding(entries, position)].page
    : preceding(pages, position);
}
export function pagesInRange(
  pages: readonly RangedPage[],
  from: number,
  to: number,
): number[] {
  if (!pages.length || to < from) return [];
  if (to === from) return [physicalPageAtPosition(pages, from)!];
  const entries = index(pages);
  if (!entries) {
    const first = physicalPageAtPosition(pages, from)!,
      last = physicalPageAtPosition(pages, to - 1)!;
    return Array.from({ length: last - first + 1 }, (_, i) => first + i);
  }
  const found = new Set<number>();
  for (
    let i = preceding(entries, from);
    i < entries.length && entries[i].from < to;
    i++
  )
    if (entries[i].to > from) found.add(entries[i].page);
  return [...found].sort((a, b) => a - b);
}
/** Split a DOM text node into visible and hidden spans without dropping layout. */
export function pageTextSegments(
  page: RangedPage,
  start: number,
  length: number,
) {
  const end = start + length,
    segments: (PageRange & { visible: boolean })[] = [];
  let at = start;
  for (const range of pageRanges(page)) {
    const from = Math.max(start, range.from),
      to = Math.min(end, range.to);
    if (to <= from) continue;
    if (from > at)
      segments.push({ from: at - start, to: from - start, visible: false });
    segments.push({ from: from - start, to: to - start, visible: true });
    at = to;
  }
  if (at < end) segments.push({ from: at - start, to: length, visible: false });
  return segments;
}
