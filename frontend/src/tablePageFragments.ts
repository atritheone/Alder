import type { EditorView } from "prosemirror-view";
import type { FlowPage, PageLayout } from "./pageFlow";
import { pageAtY, documentCanvasWidth } from "./sectionLayout";
import type { PageRange } from "./pageRanges";

/** Map the measured parallel cell flows back to their authored intervals. */
export function tablePageFragments(
  view: EditorView,
  layout: PageLayout,
  pages: FlowPage[],
  tables: PageRange[],
): FlowPage[] {
  const canvas = view.dom.closest<HTMLElement>(".flow-canvas")!;
  const origin = canvas.getBoundingClientRect();
  const scale = origin.width / documentCanvasWidth(view.state.doc, layout);
  const ranges: PageRange[][] = pages.map((page) => {
    let remaining = [{ from: page.from, to: page.to }];
    for (const table of tables)
      remaining = remaining.flatMap((range) =>
        range.to <= table.from || range.from >= table.to
          ? [range]
          : [
              ...(range.from < table.from
                ? [{ from: range.from, to: table.from }]
                : []),
              ...(range.to > table.to
                ? [{ from: table.to, to: range.to }]
                : []),
            ],
      );
    return remaining.filter((range) => range.to > range.from);
  });
  const physical = (position: number) =>
    Math.min(
      pages.length - 1,
      Math.max(
        0,
        pageAtY(
          pages,
          (view.coordsAtPos(position, 1).top - origin.top) / scale,
          layout,
        ),
      ),
    );
  for (const table of tables)
    view.state.doc.nodesBetween(table.from, table.to, (node, pos) => {
      if (!node.isTextblock) return;
      const start = pos + 1,
        end = pos + node.nodeSize - 1;
      let from = start,
        rangeStart = pos;
      const last = physical(end);
      while (from <= end) {
        const current = physical(from);
        if (current === last) {
          ranges[current].push({ from: rangeStart, to: pos + node.nodeSize });
          break;
        }
        let low = from + 1,
          high = end;
        while (low < high) {
          const mid = (low + high) >>> 1;
          if (physical(mid) > current) high = mid;
          else low = mid + 1;
        }
        ranges[current].push({ from: rangeStart, to: low });
        rangeStart = from = low;
      }
      return false;
    });
  return pages.map((page, i) => {
    const sorted = ranges[i].sort((a, b) => a.from - b.from),
      fragments: PageRange[] = [];
    for (const range of sorted) {
      const prior = fragments.at(-1);
      if (prior && range.from <= prior.to)
        prior.to = Math.max(prior.to, range.to);
      else fragments.push({ ...range });
    }
    return {
      ...page,
      fragments,
      from: fragments[0]?.from ?? page.from,
      to: fragments.at(-1)?.to ?? page.to,
      text: fragments
        .map((range) => view.state.doc.textBetween(range.from, range.to, "\n"))
        .join("\n"),
    };
  });
}
