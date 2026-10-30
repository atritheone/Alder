import type { EditorView } from "prosemirror-view";
import type { FlowPage, PageLayout } from "./pageFlow";
import { pageInsets } from "./pageGeometry";
import { pageRanges } from "./pageRanges";
import type { Node as PMNode } from "prosemirror-model";

export type ColumnContinuation = { offset: number; start: number };
type Limits = NonNullable<PageLayout["columnLimits"]>;
type BalancedPrefix = {
  pos: number;
  end: number;
  limitCount: number;
};
const cache = new WeakMap<
  EditorView,
  {
    key: string;
    doc: PMNode;
    prefixes: BalancedPrefix[];
    limits: Limits;
    continuations: Map<number, ColumnContinuation>;
  }
>();
/** Balance only the tail of a section ending continuously. A following section
 * consumes the remaining height on that sheet before acquiring a full page. */
export function balanceColumns(
  view: EditorView,
  virtual: PageLayout,
  initial: FlowPage[],
  measure: (limits: Limits) => FlowPage[],
  invalidate = false,
) {
  let regions = initial;
  const limits: NonNullable<PageLayout["columnLimits"]> = [],
    continuations = new Map<number, ColumnContinuation>();
  const boundaries: { pos: number; next: number }[] = [];
  view.state.doc.forEach((node, pos) => {
    if (node.type.name === "section_break") {
      const prior = boundaries.at(-1);
      if (prior) prior.next = pos;
      if (node.attrs.kind === "continuous")
        boundaries.push({ pos, next: view.state.doc.content.size + 1 });
    }
  });
  const key = JSON.stringify(virtual),
    old = cache.get(view),
    prefixes: BalancedPrefix[] = [];
  let reused = -1;
  if (!invalidate && old?.key === key) {
    const difference =
      old.doc.content.findDiffStart(view.state.doc.content) ??
      view.state.doc.content.size;
    const positions = new Set(boundaries.map((boundary) => boundary.pos));
    for (const prior of old.prefixes) {
      if (!positions.has(prior.pos) || prior.end > difference) break;
      prefixes.push(prior);
      reused = prior.pos;
    }
    const last = prefixes.at(-1);
    if (last) {
      limits.push(
        ...old.limits.slice(0, last.limitCount).map((limit) => ({
          ...limit,
          ...(limit.regions
            ? {
                to:
                  boundaries.find((b) => b.pos === limit.from)?.next ??
                  limit.to,
              }
            : {}),
        })),
      );
      for (const [pos, continuation] of old.continuations)
        if (pos <= last.pos) continuations.set(pos, continuation);
      regions = measure(limits);
    }
  }
  const canvas = view.dom.closest<HTMLElement>(".flow-canvas")!,
    scale =
      canvas.getBoundingClientRect().width / parseFloat(canvas.style.width);
  for (const boundary of boundaries) {
    if (boundary.pos <= reused) continue;
    let end = regions.findIndex((r) => r.from === boundary.pos);
    if (end <= 0) continue;
    const prior = regions[end - 1].frame?.layout || virtual,
      next = regions[end].frame?.layout || virtual;
    const source = prior.columnSource || prior,
      after = next.columnSource || next;
    if (
      Math.abs(source.width - after.width) > 0.01 ||
      Math.abs(source.height - after.height) > 0.01
    )
      continue;
    const count = source.columns?.count || 1;
    let first = 0,
      column = 0;
    for (let i = 0; i < end; i++) {
      const node = view.state.doc.nodeAt(regions[i].from),
        resolved = view.state.doc.resolve(regions[i].from);
      if (
        node?.type.name === "section_break" ||
        node?.type.name === "page_break" ||
        resolved.parent.attrs.pageBreakBefore
      )
        column = 0;
      if (!column) first = i;
      column =
        (column + 1) %
        ((regions[i].frame?.layout.columnSource || virtual.columnSource)
          ?.columns?.count || 1);
    }
    const from = regions[first].from,
      inset = pageInsets(source),
      available =
        regions[first].columnHeight || source.height - inset.top - inset.bottom;
    const endElement = view.nodeDOM(boundary.pos) as HTMLElement;
    const origin = canvas.getBoundingClientRect();
    const lastTop = (regions[end - 1].frame?.top || 0) + pageInsets(prior).top;
    const used = Math.max(
      1,
      (endElement.getBoundingClientRect().top - origin.top) / scale - lastTop,
    );
    let height = Math.min(available, used + (end - first - 1) * available);
    if (count > 1) {
      const limit = { from, to: boundary.pos, height: available };
      limits.push(limit);
      let low = 1,
        high = available;
      for (let pass = 0; pass < 12 && high - low > 0.5; pass++) {
        limit.height = (low + high) / 2;
        regions = measure(limits);
        const start = regions.findIndex((r) =>
            pageRanges(r).some(
              (range) => range.from <= from && range.to > from,
            ),
          ),
          stop = regions.findIndex((r) => r.from === boundary.pos);
        let fits = start >= 0 && stop > start && stop - start <= count;
        if (fits)
          for (let i = start; i < stop; i++) {
            const region = regions[i],
              top =
                (region.frame?.top || 0) +
                pageInsets(region.frame?.layout || virtual).top;
            for (const range of pageRanges(region))
              view.state.doc.nodesBetween(
                range.from,
                Math.min(range.to, boundary.pos),
                (node, pos) => {
                  if (!fits) return false;
                  if (node.isText) {
                    const end = Math.min(
                      pos + node.nodeSize,
                      range.to,
                      boundary.pos,
                    );
                    const rect = view.coordsAtPos(Math.max(pos, end - 1), 1);
                    if (
                      (rect.bottom - origin.top) / scale >
                      top + limit.height + 1
                    )
                      fits = false;
                  } else if (
                    ["image", "inline_image"].includes(node.type.name)
                  ) {
                    const element = view.nodeDOM(pos) as HTMLElement | null;
                    if (
                      element &&
                      (element.getBoundingClientRect().bottom - origin.top) /
                        scale >
                        top + limit.height + 1
                    )
                      fits = false;
                  }
                },
              );
          }
        if (fits) high = limit.height;
        else low = limit.height;
      }
      // Give the next section a complete line box, including leading outside
      // glyph bounds. Native caret rectangles alone omit that leading.
      const pos = Math.min(view.state.doc.content.size, from + 1),
        dom = view.domAtPos(pos).node;
      const element = (
        dom instanceof Element ? dom : dom.parentElement
      )?.closest("p,h1,h2,h3,h4,h5,h6");
      const leading = element
        ? parseFloat(getComputedStyle(element).lineHeight)
        : 0;
      height = Math.min(
        available,
        leading > 0 ? Math.ceil((high - 0.5) / leading) * leading : high + 0.5,
      );
      limit.height = height;
      regions = measure(limits);
      end = regions.findIndex((r) => r.from === boundary.pos);
    }
    let offset = 0;
    const startNode = view.state.doc.nodeAt(from);
    if (startNode?.type.name === "section_break")
      offset = continuations.get(from)?.offset || 0;
    const start = inset.top + offset + height;
    const remaining = source.height - inset.bottom - start;
    if (remaining < 20) continue;
    continuations.set(boundary.pos, {
      offset: start - pageInsets(after).top,
      start,
    });
    limits.push({
      from: boundary.pos,
      to: boundary.next,
      height: remaining,
      regions: after.columns?.count || 1,
    });
    regions = measure(limits);
    prefixes.push({
      pos: boundary.pos,
      end: boundary.pos + view.state.doc.nodeAt(boundary.pos)!.nodeSize,
      limitCount: limits.length,
    });
  }
  cache.set(view, {
    key,
    doc: view.state.doc,
    prefixes,
    limits: limits.map((limit) => ({ ...limit })),
    continuations,
  });
  return { regions, continuations, limits };
}
