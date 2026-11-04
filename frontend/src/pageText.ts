import { Fragment, type Node as PMNode } from "prosemirror-model";

/** Extract many page ranges without walking from the start of the manuscript
 * for every page. The bounded fragment still uses ProseMirror's textBetween,
 * retaining its exact separators, empty-block and leaf-text semantics. */
export function pageText(doc: PMNode) {
  const offsets: number[] = [];
  doc.forEach((_node, pos) => offsets.push(pos));
  offsets.push(doc.content.size);
  const after = (position: number) => {
    let lo = 0, hi = doc.childCount;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (offsets[mid + 1] <= position) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return (from: number, to: number): string => {
    if (from < 0 || to > doc.content.size || to < from)
      throw new RangeError("Invalid page text range.");
    if (from === to) return "";
    const first = after(from), last = after(to - 1);
    const fragment = Fragment.fromArray(doc.content.content.slice(first, last + 1));
    return fragment.textBetween(from - offsets[first], to - offsets[first], "\n");
  };
}
