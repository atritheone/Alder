import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { pageInsets } from "./pageGeometry";
import {
  paginatePages,
  PAGE_GAP,
  type PageLayout,
  type FlowPage,
} from "./pageFlow";
import { pageRanges, pagesInRange, physicalPageAtPosition } from "./pageRanges";
import { withRunningHeadings } from "./runningHeadings";
import { layoutParagraphPaint, projectColumnPaint } from "./paragraphPaint";
import { columnMeasurement } from "./columns";
import { layoutMirroredMargins } from "./mirroredMargins";
import { documentCanvasWidth } from "./sectionLayout";
import { tableHeaderHTML } from "./tablePageHeaders";
import { sectionNumbering } from "./pageNumbering";
import { balanceColumns } from "./columnBalancing";
import { hyphenationLayoutChange } from "./hyphenation";

export type { Columns } from "./columns";
const key = new PluginKey<DecorationSet>("column-placement");
export const columnPlacementPlugin = () =>
  new Plugin({
    key,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, old) => tr.getMeta(key) ?? old.map(tr.mapping, tr.doc),
    },
    props: { decorations: (state) => key.getState(state) },
  });
function place(view: EditorView, next: DecorationSet) {
  if (key.getState(view.state) !== next)
    view.updateState(
      view.state.apply(
        view.state.tr.setMeta(key, next).setMeta("addToHistory", false),
      ),
    );
}
type Shift = { x: number; y: number };
const contexts = new WeakMap<
  EditorView,
  { regions: FlowPage[]; shifts: Shift[]; regionPages:number[] }
>();
export function columnShiftToPosition(
  view: EditorView,
  from: number,
  to: number,
) {
  const context = contexts.get(view);
  if (!context) return 0;
  return (
    context.shifts[physicalPageAtPosition(context.regions, to) ?? 0].x -
    context.shifts[physicalPageAtPosition(context.regions, from) ?? 0].x
  );
}
/** BR has no paintable CSS box to translate. Measure an otherwise empty line
 * in its physical column using the same projection as its surrounding text. */
export function columnBreakRect(view:EditorView,paragraph:number,position:number,rect:DOMRect,scale:number) {
  const context=contexts.get(view);
  if(!context)return rect;
  const first=physicalPageAtPosition(context.regions,paragraph+1)??0;
  const at=physicalPageAtPosition(context.regions,position)??first;
  const source=context.shifts[first],target=context.shifts[at];
  if(!source||!target)return rect;
  return new DOMRect(rect.x+(target.x-source.x)*scale,rect.y+(target.y-source.y)*scale,rect.width,rect.height);
}
export function columnParagraphRects(
  view: EditorView,
  node: PMNode,
  pos: number,
): DOMRect[] | null {
  const context = contexts.get(view);
  if (!context) return null;
  const element = view.nodeDOM(pos) as HTMLElement | null;
  if (!element) return [];
  const box = element.getBoundingClientRect(),
    scale = box.width / element.offsetWidth;
  const first = physicalPageAtPosition(context.regions, pos + 1) ?? 0;
  const result: DOMRect[] = [];
  for (const index of pagesInRange(
    context.regions,
    pos + 1,
    pos + node.nodeSize - 1,
  )) {
    const lines: DOMRect[] = [];
    for (const interval of pageRanges(context.regions[index])) {
      const from = Math.max(pos + 1, interval.from),
        to = Math.min(pos + node.nodeSize - 1, interval.to);
      if (to <= from) continue;
      view.state.doc.nodesBetween(from, to, (child, at) => {
        if (!child.isText) return;
        const start = view.domAtPos(Math.max(at, from)),
          end = view.domAtPos(Math.min(at + child.nodeSize, to));
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        lines.push(
          ...[...range.getClientRects()].filter(
            (r) => r.width > 0 && r.height > 0,
          ),
        );
      });
    }
    if (lines.length) {
      const top = Math.min(...lines.map((r) => r.top)),
        bottom = Math.max(...lines.map((r) => r.bottom));
      result.push(
        new DOMRect(
          box.left +
            (context.shifts[index].x - context.shifts[first].x) * scale,
          top,
          box.width,
          bottom - top,
        ),
      );
    }
  }
  return result.length ? result : [box];
}
function placement(doc: PMNode, regions: FlowPage[], shifts: Shift[]) {
  const decorations: Decoration[] = [];
  const walk = (
    node: PMNode,
    pos: number,
    inherited: Shift,
    topLevel = false,
  ) => {
    if (
      !node.isBlock ||
      ["page_break", "column_break", "section_break"].includes(node.type.name)
    )
      return;
    const start = Math.min(doc.content.size, pos + 1),
      end = pos + node.nodeSize - 1;
    const owned = pagesInRange(regions, start, Math.max(start, end));
    const first = owned[0] ?? physicalPageAtPosition(regions, start) ?? 0,
      last = owned.at(-1) ?? first;
    const shift = shifts[first];
    if (!shift) return;
    const dx = shift.x - inherited.x,
      dy = shift.y - inherited.y;
    if (dx || dy)
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          style:
            node.type.name === "table_row"
              ? `transform:translate(${dx}px,${dy}px)`
              : `position:relative;left:${topLevel ? `calc(var(--section-block-left,0px) + ${dx}px)` : `${dx}px`};top:${dy}px`,
        }),
      );
    if (first === last) return;
    if (!node.isTextblock) {
      node.forEach((child, offset) => walk(child, pos + offset + 1, shift));
      return;
    }
    for (let i = first; i <= last; i++) {
      const dx = shifts[i].x - shift.x,
        dy = shifts[i].y - shift.y;
      if (!dx && !dy) continue;
      for (const range of pageRanges(regions[i])) {
        const from = Math.max(start, range.from),
          to = Math.min(end, range.to);
        if (to > from)
          decorations.push(
            Decoration.inline(from, to, {
              class: "column-fragment",
              style: `position:relative;left:${dx}px;--column-fragment-y:${dy}px;top:calc(var(--cell-fragment-y,0px) + ${dy}px)`,
            }),
          );
      }
    }
  };
  doc.forEach((node, pos) => walk(node, pos, { x: 0, y: 0 }, true));
  return DecorationSet.create(doc, decorations);
}

/** Each column first uses the ordinary measured flow. Projection moves that
 * same editable text into physical columns; no authored content is copied. */
export function paginateColumns(
  view: EditorView,
  layout: PageLayout,
  apply: (value: DecorationSet) => void,
  invalidate = false,
): FlowPage[] {
  let enabled = (layout.columns?.count || 1) > 1;
  view.state.doc.forEach((node) => {
    if (
      node.type.name === "section_break" &&
      (node.attrs.page?.columns?.count || 1) > 1
    )
      enabled = true;
  });
  view.dom.toggleAttribute("data-column-layout", enabled);
  place(view, DecorationSet.empty);
  if (!enabled) {
    contexts.delete(view);
    view.dom.style.removeProperty("width");
    view.dom.parentElement?.style.removeProperty("height");
    view.dom.parentElement?.style.removeProperty("overflow");
    return paginatePages(view, layout, apply, invalidate);
  }
  layoutMirroredMargins(view, { ...layout, mirrorMargins: false }, []);
  const virtual = columnMeasurement(layout),
    inset = pageInsets(virtual),
    canvasWidth = documentCanvasWidth(view.state.doc, layout);
  const prior=contexts.get(view);
  if(layout.pageReserves?.length&&prior){
    virtual.pageReserves=prior.regionPages.map(page=>layout.pageReserves![page]||0);
  }
  if(layout.pageMinimums?.length&&prior){
    virtual.pageMinimums=layout.pageMinimums.map(minimum=>{
      let region=prior.regionPages.findIndex(page=>page>=minimum.page);
      if(region<0)region=prior.regionPages.length+(minimum.page-(prior.regionPages.at(-1)||0)-1)*(layout.columns?.count||1);
      return {...minimum,page:region};
    });
  }
  view.dom.style.width = `${virtual.width - inset.left - inset.right}px`;
  const invalidateBalance = invalidate || !!hyphenationLayoutChange(view);
  const balanced = balanceColumns(
    view,
    virtual,
    paginatePages(view, virtual, apply, invalidate),
    (limits) =>
      paginatePages(
        view,
        { ...virtual, columnLimits: limits.map((limit) => ({ ...limit })) },
        apply,
      ),
    invalidateBalance,
  );
  const regions = balanced.regions,
    shifts: Shift[] = [],
    pages: FlowPage[] = [];
  const regionPages: number[] = [];
  let column = 0,
    numberOffset = layout.firstPageNumber || 1,
    sectionStart = 0,
    bandOffset = 0;
  regions.forEach((region, index) => {
    const measured = region.frame?.layout || virtual,
      source = measured.columnSource || layout,
      margins = pageInsets(source),
      columns = source.columns || { count: 1, gapMm: 8 };
    const gap = (columns.gapMm * 96) / 25.4,
      width =
        (source.width -
          margins.left -
          margins.right -
          gap * (columns.count - 1)) /
        columns.count;
    const boundary = view.state.doc.nodeAt(region.from),
      resolved = view.state.doc.resolve(region.from),
      section = boundary?.type.name === "section_break";
    const forced =
      boundary?.type.name === "page_break" ||
      section ||
      resolved.parent.attrs.pageBreakBefore;
    if (forced) column = 0;
    const continuation = section
      ? balanced.continuations.get(region.from)
      : undefined;
    if (section) bandOffset = continuation?.offset || 0;
    const append = (
      from: number,
      to: number,
      text: string,
      physical: PageLayout,
    ) => {
      const last = pages.at(-1)?.frame;
      pages.push({
        from,
        to,
        text,
        frame: {
          top: last ? last.top + last.layout.height + PAGE_GAP : 0,
          left: (canvasWidth - physical.width) / 2,
          layout: physical,
        },
      });
    };
    if (!column && !continuation) {
      bandOffset = 0;
      if (section) {
        const numbering = sectionNumbering(
          pages.length + numberOffset,
          boundary.attrs.kind,
          boundary.attrs.numberingStart,
        );
        if (numbering.blank)
          append(
            region.from,
            region.from,
            "",
            pages.at(-1)?.frame?.layout || layout,
          );
        numberOffset = numbering.number - pages.length;
        sectionStart = pages.length;
      }
      append(region.from, region.to, region.text, {
        ...source,
        runningMatter: measured.runningMatter,
        runningSectionId: measured.runningSectionId,
        pageNumberFormat: measured.pageNumberFormat,
        pageNumberOffset: numberOffset,
        sectionStartPage: sectionStart,
      });
    } else {
      if (continuation) {
        sectionStart = pages.length - 1;
        if (boundary?.attrs.numberingStart != null)
          numberOffset = boundary.attrs.numberingStart - sectionStart;
      }
      const current = pages.at(-1)!;
      current.to = Math.max(current.to, region.to);
      current.from = Math.min(current.from, region.from);
      current.text += "\n" + region.text;
    }
    const page = pages.length - 1,
      current = pages[page],
      frame = current.frame!,
      number = page + (frame.layout.pageNumberOffset ?? numberOffset);
    const previousRanges = current.fragments || [];
    if (!column && columns.separator) {
      const top = margins.top + bandOffset,
        height =
          region.columnHeight ?? source.height - margins.top - margins.bottom;
      for (let i = 1; i < columns.count; i++)
        (current.columnRules ??= []).push({
          x:
            (layout.mirrorMargins && number % 2 === 0
              ? margins.right
              : margins.left) +
            i * (width + gap) -
            gap / 2,
          top,
          bottom: top + height,
        });
    }
    current.fragments = [...previousRanges, ...pageRanges(region)].sort(
      (a, b) => a.from - b.from,
    );
    regionPages.push(page);
    shifts.push({
      x:
        column * (width + gap) +
        (layout.mirrorMargins && number % 2 === 0
          ? margins.right - margins.left
          : 0),
      y:
        frame.top +
        bandOffset -
        (region.frame?.top ?? index * (layout.height + PAGE_GAP)),
    });
    column = (column + 1) % columns.count;
  });
  layoutParagraphPaint(view, virtual, regions, layout.runningStyles, true);
  regions.forEach((region, index) => {
    if (!region.header) return;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = tableHeaderHTML(
      view,
      region.frame?.layout || virtual,
      region.header,
    );
    for(const element of [...wrapper.children] as HTMLElement[]){
    element.style.left = `${parseFloat(element.style.left) + shifts[index].x}px`;
    element.style.top = `${parseFloat(element.style.top) + shifts[index].y - (pages[regionPages[index]].frame!.top - (region.frame?.top ?? index * (layout.height + PAGE_GAP)))}px`;
    (pages[regionPages[index]].columnHeaders ??= []).push(element.outerHTML);
    }
  });
  projectColumnPaint(
    view,
    regions.map((region, index) => ({
      top: region.frame?.top ?? index * (layout.height + PAGE_GAP),
      pageTop: pages[regionPages[index]].frame!.top,
      ...shifts[index],
    })),
  );
  place(view, placement(view.state.doc, regions, shifts));
  contexts.set(view, { regions, shifts, regionPages });
  const last = pages.at(-1)!.frame!,
    host = view.dom.parentElement!;
  host.style.height = `${last.top + last.layout.height}px`;
  host.style.overflow = "clip";
  for (const page of pages) {
    const ranges: { from: number; to: number }[] = [];
    for (const range of page.fragments || []) {
      const previous = ranges.at(-1);
      if (previous && range.from <= previous.to)
        previous.to = Math.max(previous.to, range.to);
      else ranges.push({ ...range });
    }
    if (
      ranges.length === 1 &&
      ranges[0].from === page.from &&
      ranges[0].to === page.to
    )
      delete page.fragments;
    else if (ranges.length) page.fragments = ranges;
  }
  return withRunningHeadings(view.state.doc, pages, layout);
}
