import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { pageInsets } from "./pageGeometry";
import { pageRanges, pagesInRange, physicalPageAtPosition } from "./pageRanges";
import type { FlowPage, PageLayout } from "./pageFlow";
import { sectionLayout } from "./sectionLayout";

const key = new PluginKey<DecorationSet>("page-horizontal-placement");
const placements = new WeakMap<
  PMNode,
  { signature: string; decorations: DecorationSet }
>();
const layouts = new WeakMap<
  EditorView,
  { layout: PageLayout; pages: FlowPage[] }
>();
const sections = new WeakMap<
  PMNode,
  { base: PageLayout; entries: { from: number; layout: PageLayout }[] }
>();
function sectionAt(doc: PMNode, base: PageLayout, position: number) {
  let cached = sections.get(doc);
  if (cached?.base !== base) {
    const entries = [{ from: 0, layout: base }];
    doc.forEach((node, pos) => {
      if (node.type.name === "section_break")
        entries.push({
          from: pos + node.nodeSize,
          layout: sectionLayout(base, node.attrs.page),
        });
    });
    cached = { base, entries };
    sections.set(doc, cached);
  }
  let low = 0,
    high = cached.entries.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (cached.entries[mid].from <= position) low = mid;
    else high = mid - 1;
  }
  return cached.entries[low].layout;
}
function offset(
  layout: PageLayout,
  pages: FlowPage[],
  index: number,
  horizontal = layout,
) {
  const current = pages[index]?.frame?.layout || layout;
  const number =
      index + (current.pageNumberOffset ?? current.firstPageNumber ?? 1),
    margins = pageInsets(horizontal);
  return layout.mirrorMargins && number % 2 === 0
    ? margins.right - margins.left
    : 0;
}
export function mirrorShiftToPage(
  view: EditorView,
  source: number,
  page: number,
  sourcePage?: number,
) {
  const value = layouts.get(view);
  if (!value?.layout.mirrorMargins) return 0;
  return (
    offset(
      value.layout,
      value.pages,
      page,
      sectionAt(view.state.doc, value.layout, source),
    ) -
    offset(
      value.layout,
      value.pages,
      sourcePage ?? physicalPageAtPosition(value.pages, source) ?? 0,
      sectionAt(view.state.doc, value.layout, source),
    )
  );
}
export function mirrorShiftToPosition(
  view: EditorView,
  source: number,
  target: number,
) {
  const value = layouts.get(view);
  return value
    ? mirrorShiftToPage(
        view,
        source,
        physicalPageAtPosition(value.pages, target) ?? 0,
      )
    : 0;
}
export function mirroredPageLayout(
  layout: PageLayout,
  page: number,
): PageLayout {
  const number =
    page + (layout.pageNumberOffset ?? layout.firstPageNumber ?? 1);
  if (!layout.mirrorMargins || number % 2 !== 0) return layout;
  const margins = pageInsets(layout);
  return {
    ...layout,
    margins: { ...margins, left: margins.right, right: margins.left },
  };
}
export const horizontalPagePlacement = () =>
  new Plugin({
    key,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, previous) =>
        tr.getMeta(key) ?? previous.map(tr.mapping, tr.doc),
    },
    props: { decorations: (state) => key.getState(state) },
  });

/** A horizontal-only projection preserves the measured line widths and native
 * editable text. Whole blocks move together; spanning prose moves by its
 * authored page intervals, without copying or changing the document. */
export function mirroredPlacement(
  doc: PMNode,
  layout: PageLayout,
  pages: FlowPage[],
) {
  if (!layout.mirrorMargins || !pages.length) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  const signature = JSON.stringify([
    pageInsets(layout),
    pages.map((page, index) => [
      index +
        (page.frame?.layout.pageNumberOffset ??
          page.frame?.layout.firstPageNumber ??
          layout.firstPageNumber ??
          1),
      pageRanges(page),
    ]),
  ]);
  const cached = placements.get(doc);
  if (cached?.signature === signature) return cached.decorations;
  const walk = (
    node: PMNode,
    pos: number,
    inherited: number,
    topLevel = false,
  ) => {
    if (
      !node.isBlock ||
      node.type.name === "section_break" ||
      node.type.name === "page_break"
    )
      return;
    const start = Math.min(doc.content.size, pos + 1),
      end = pos + node.nodeSize - 1;
    const owned = pagesInRange(pages, start, Math.max(start, end)),
      first = owned[0] ?? physicalPageAtPosition(pages, start)!,
      last = owned.at(-1) ?? first;
    const horizontal = sectionAt(doc, layout, pos),
      firstOffset = offset(layout, pages, first, horizontal);
    if (firstOffset !== inherited)
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          style:
            node.type.name === "table_row"
              ? `transform:translateX(${firstOffset - inherited}px)`
              : `position:relative;left:${topLevel ? `calc(var(--section-block-left, 0px) + ${firstOffset - inherited}px)` : `${firstOffset - inherited}px`}`,
        }),
      );
    if (first === last) {
      return false;
    }
    if (!node.isTextblock) {
      node.forEach((child, offset) =>
        walk(child, pos + offset + 1, firstOffset),
      );
      return;
    }
    for (let index = first; index <= last; index++) {
      const shift = offset(layout, pages, index, horizontal) - firstOffset;
      if (!shift) continue;
      for (const range of pageRanges(pages[index])) {
        const from = Math.max(start, range.from),
          to = Math.min(end, range.to);
        if (to > from)
          decorations.push(
            Decoration.inline(from, to, {
              class: "mirrored-page-fragment",
              style: `position:relative;left:${shift}px`,
            }),
          );
      }
    }
    return false;
  };
  doc.forEach((node, pos) => walk(node, pos, 0, true));
  const result = DecorationSet.create(doc, decorations);
  placements.set(doc, { signature, decorations: result });
  return result;
}

export function layoutMirroredMargins(
  view: EditorView,
  layout: PageLayout,
  pages: FlowPage[],
) {
  layouts.set(view, { layout, pages });
  view.dom.toggleAttribute("data-mirrored-margins", !!layout.mirrorMargins);
  const next = mirroredPlacement(view.state.doc, layout, pages);
  if (key.getState(view.state) === next) return;
  view.updateState(
    view.state.apply(
      view.state.tr.setMeta(key, next).setMeta("addToHistory", false),
    ),
  );
}
