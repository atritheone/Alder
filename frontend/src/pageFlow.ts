import { Fragment, Slice, type Node as PMNode } from "prosemirror-model";
import { Mapping, StepMap } from "prosemirror-transform";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { pageInsets, type PageGeometry } from "./pageGeometry";
import { TableMap } from "prosemirror-tables";
import { documentCanvasWidth, sectionLayout, pageAtY } from "./sectionLayout";
import { tableRowBoundary,parallelCellStories } from "./tableStructure";
import {tableHeaderHeight,type FlowHeader} from "./tablePageHeaders";
import { sectionNumbering, type PageNumberFormat } from "./pageNumbering";
import { layoutTabs } from "./tabLayout";
import {
  hasDiscretionaryBreak,
  hyphenationLayoutChange,
  clearHyphenationLayoutChange,
} from "./hyphenation";
import { layoutExactLeading } from "./exactLeading";
import {
  physicalPageAtPosition,
  contiguousPage,
  type PageRange,
} from "./pageRanges";
import { tablePageFragments } from "./tablePageFragments";
import {tableAlignmentBase,alignedTableCells} from './tableCellAlignment';
import {mergedTableRows,mergedRowHeights} from './mergedTableRows';
import {
  resolveRunningMatter,
  defaultRunningMatter,
  type RunningMatter,
} from "./runningMatter";
import type { NamedStyle, Project } from "./types";
import {
  withRunningHeadings,
  type HeadingField,
  type HeadingContext,
} from "./runningHeadings";

export type PageLayout = PageGeometry & {
  noteStarts?: import('./documentNotes').NoteStarts;
  noteOptions?: import('./noteOptions').NoteOptions;
  // Derived note layout; these are never stored as authored page settings.
  pageReserves?: number[];
  pageMinimums?: {pos:number;page:number}[];
  columns?: import('./columnLayout').Columns;
  columnSource?: PageLayout;
  columnLimits?: {from:number;to:number;height:number;regions?:number}[];
  mirrorMargins?: boolean;
  language?: string;
  lineHeight: number;
  zoom: number;
  header?: string;
  footer?: boolean;
  firstPageNumber?: number;
  pageNumberFormat?: PageNumberFormat;
  // Derived offset from the physical page index, including section restarts.
  pageNumberOffset?: number;
  fontFamily?: string;
  runningMatter?: RunningMatter;
  runningStyles?: NamedStyle[];
  sectionStartPage?: number;
  runningSectionId?: string;
  runningHeadings?: Partial<Record<HeadingField, string>>;
  headingContext?: HeadingContext;
};
export type FlowPage = {
  overflowingNoteRows?:string[];
  lineNumbers?:{x:number;y:number;number:number;fontFamily:string}[];
  noteHTML?:string;
  columnHeaders?:string[];
  columnHeight?:number;
  columnRules?:{x:number;top:number;bottom:number}[];
  from: number;
  to: number;
  text: string;
  fragments?: readonly PageRange[];
  header?: FlowHeader[];
  section?: number;
  frame?: { top: number; left: number; layout: PageLayout };
};
export function pageAtPosition(
  pages: FlowPage[],
  position: number,
): number | null {
  return physicalPageAtPosition(pages, position);
}
export const PAGE_GAP = 28;
type PageSpacer = {
  key?: string;
  pos: number;
  height: number;
  nodeSize?: number;
  row?: boolean;
  header?: FlowHeader[];
};
type FlowCache = {
  doc: PMNode;
  key: string;
  spacers: PageSpacer[];
  pages: FlowPage[];
  renderedPages?: FlowPage[];
  decorations: DecorationSet;
  continuousStates?: { pos: number; page: number; layout: PageLayout }[];
};
const flowCache = new WeakMap<EditorView, FlowCache>();
let nextSpacerKey = 0;
const sectionPresentation = new WeakMap<
  EditorView,
  WeakMap<HTMLElement, { node: PMNode; key: string; style: string }>
>();
const sectionSheets = new WeakMap<EditorView, HTMLStyleElement>();
let nextSectionSheet = 0;

export function disposePageLayout(view: EditorView) {
  const sheet = sectionSheets.get(view);
  const parent = view.dom.parentElement;
  if (
    sheet &&
    parent &&
    parent.getAttribute("data-page-flow") === sheet.dataset.pageFlow
  )
    parent.removeAttribute("data-page-flow");
  sheet?.remove();
  sectionSheets.delete(view);
  sectionPresentation.delete(view);
  flowCache.delete(view);
}

/** Paginate one continuous editable document using layout-only spacers.
 * Nothing is inserted into the document or its undo/export history.
 */
export function paginatePages(
  view: EditorView,
  layout: PageLayout,
  apply: (decorations: DecorationSet) => void,
  invalidate = false,
): FlowPage[] {
  const doc = view.state.doc;
  const hyphenChange = hyphenationLayoutChange(view);
  clearHyphenationLayoutChange(view);
  if (hyphenChange && hyphenChange.doc !== doc) invalidate = true;
  const hasSections = Array.from({ length: doc.childCount }, (_, i) =>
    doc.child(i),
  ).some((n) => n.type.name === "section_break");
  const hasNumberRestarts =
    hasSections &&
    Array.from({ length: doc.childCount }, (_, i) => doc.child(i)).some(
      (n) => n.type.name === "section_break" && n.attrs.numberingStart != null,
    );
  const hasContinuous =
    hasSections &&
    Array.from({ length: doc.childCount }, (_, i) => doc.child(i)).some(
      (n) => n.type.name === "section_break" && n.attrs.kind === "continuous",
    );
  const canvasWidth = documentCanvasWidth(doc, layout);
  const key = JSON.stringify([
    layout.language,
    layout.mirrorMargins,
    layout.columns,
    layout.pageBorder,
    layout.watermark,
    layout.lineNumbering,
    layout.columnLimits,
    layout.pageReserves,
    layout.pageMinimums,
    layout.noteOptions,
    layout.noteStarts,
    layout.width,
    layout.height,
    pageInsets(layout),
    layout.lineHeight,
    view.dom.offsetWidth,
    canvasWidth,
    layout.header,
    layout.footer,
    layout.firstPageNumber,
    layout.pageNumberFormat,
    layout.fontFamily,
    layout.runningMatter,
    layout.headingContext,
  ]);
  const candidate =
    !invalidate && flowCache.get(view)?.key === key
      ? flowCache.get(view)
      : undefined;
  // Display zoom is a transform; it cannot change the logical page map.
  if (candidate?.doc.eq(doc) && !hyphenChange) {
    apply(candidate.decorations);
    return candidate.renderedPages || candidate.pages;
  }
  const previous =
    candidate?.pages.some((page) => page.fragments) ||
    hasSections !== !!candidate?.pages.some((page) => page.frame)
      ? undefined
      : candidate;
  let diff = previous?.doc.content.findDiffStart(doc.content);
  let endDiff = previous?.doc.content.findDiffEnd(doc.content);
  if (previous && hyphenChange) {
    diff = Math.min(diff ?? hyphenChange.from, hyphenChange.from);
    const delta = doc.content.size - previous.doc.content.size;
    endDiff = {
      a: Math.max(endDiff?.a ?? 0, hyphenChange.to - delta),
      b: Math.max(endDiff?.b ?? 0, hyphenChange.to),
    };
  }
  // Restart before the affected page and its top-level container. Include the
  // preceding keep-with-next chain, since a later edit may pull it forward.
  let restart = 0;
  if (previous && diff != null && diff > 0) {
    const pageIndex = Math.max(
      0,
      (pageAtPosition(previous.pages, diff) || 0) - 1,
    );
    const boundary = previous.pages[pageIndex].from;
    const resolved = doc.resolve(Math.min(boundary, doc.content.size));
    let index = resolved.index(0);
    restart = resolved.depth ? resolved.before(1) : resolved.pos;
    while (index > 0) {
      const prior = doc.child(index - 1);
      const priorPos = restart - prior.nodeSize;
      const element = view.nodeDOM(priorPos);
      if (
        !(element instanceof HTMLElement) ||
        getComputedStyle(element).breakAfter !== "avoid"
      )
        break;
      restart = priorPos;
      index--;
    }
  }
  const spacers: PageSpacer[] = previous
    ? previous.spacers
        .filter((spacer) => spacer.pos < restart)
        .map((spacer) => ({ ...spacer }))
    : [];
  const retained = spacers.length;
  // Ordinary prose can retain the untouched tail's widgets while reflowing
  // one paragraph at a time. Removing hundreds of distant spacers makes the
  // browser collapse/rebuild the entire manuscript for a local edit. Complex
  // containers and keep-with-next chains still use the complete measurement.
  const plainProse = !!previous && !!endDiff && !hasSections &&
    !layout.columnSource && !layout.pageReserves?.some(Boolean) &&
    !layout.pageMinimums?.length &&
    Array.from({length:doc.childCount},(_,i)=>doc.child(i)).every(node=>
      node.type.name==='paragraph' && !node.attrs.styleId && !node.attrs.keepWithNext &&
      Array.from({length:node.childCount},(_,i)=>node.child(i)).every(child=>child.isText||child.type.name==='hard_break'));
  let futureSpacers = plainProse ? previous!.spacers.filter(spacer=>spacer.pos>=endDiff!.a && spacer.pos+(endDiff!.b-endDiff!.a)>=restart).map(spacer=>({...spacer,pos:spacer.pos+endDiff!.b-endDiff!.a})) : [];
  let stable = false;
  const prefix =
    hasSections && previous
      ? previous.pages.slice(1).filter((page) => page.from < restart)
      : [];
  const frames = [
    { top: 0, left: (canvasWidth - layout.width) / 2, layout },
    ...prefix.map((page) => ({ ...page.frame! })),
  ];
  let currentLayout = frames.at(-1)!.layout;
  const continuousStates =
    previous?.continuousStates?.filter((state) => state.pos < restart) || [];
  const resumedContinuous = continuousStates.at(-1);
  let pendingLayout: PageLayout | undefined =
    resumedContinuous?.page === frames.length - 1
      ? resumedContinuous.layout
      : undefined;
  // Section widths do not change as pagination inserts spacers. Keep their
  // stylesheet outside the editable DOM: thousands of node decorations make
  // every spacer update expensive, while direct DOM attributes trigger parsing
  // by ProseMirror's mutation observer. Count authored children only, excluding
  // layout widgets; merge adjacent blocks with identical geometry into one rule.
  let presentation = sectionPresentation.get(view);
  if (!presentation || invalidate) {
    presentation = new WeakMap();
    sectionPresentation.set(view, presentation);
  }
  const widths: { from: number; to: number; style: string }[] = [];
  if (hasSections) {
    // nodeDOM walks the root's child descriptions. Calling it for every block
    // is quadratic on large documents; these are the same authored children
    // counted by the layout selector below. Retain the lookup fallback for an
    // unexpected node view that does not expose one root element per block.
    const elements = Array.from(view.dom.children).filter(
      (element) => !element.classList.contains("ProseMirror-widget"),
    );
    let active = layout;
    const base = pageInsets(layout);
    const geometryKey = () =>
      JSON.stringify([
        layout.width,
        base,
        active.width,
        active.height,
        pageInsets(active),
      ]);
    let activeKey = geometryKey();
    doc.forEach((node, pos, index) => {
      if (node.type.name === "section_break") {
        active = sectionLayout(layout, node.attrs.page);
        activeKey = geometryKey();
        return;
      }
      const element = (
        elements.length === doc.childCount ? elements[index] : view.nodeDOM(pos)
      ) as HTMLElement | null;
      if (!element) return;
      const cached = presentation!.get(element);
      let style =
        cached?.node === node && cached.key === activeKey
          ? cached.style
          : undefined;
      if (!style) {
        const inset = pageInsets(active),
          css = getComputedStyle(element);
        const left = (layout.width - active.width) / 2 + inset.left - base.left;
        const width =
          active.width -
          inset.left -
          inset.right -
          (parseFloat(css.marginLeft) || 0) -
          (parseFloat(css.marginRight) || 0);
        style = `position:relative;left:${left}px;--section-block-left:${left}px;width:${width}px;box-sizing:border-box;--page-width:${active.width}px;--page-height:${active.height}px;${Object.entries(
          inset,
        )
          .map(([edge, value]) => `--page-margin-${edge}:${value}px`)
          .join(";")}`;
        presentation!.set(element, { node, key: activeKey, style });
      }
      const previous = widths.at(-1);
      if (previous?.style === style && previous.to === index) previous.to++;
      else widths.push({ from: index + 1, to: index + 1, style });
    });
  }
  let sheet = sectionSheets.get(view);
  if (widths.length && !sheet) {
    sheet = view.dom.ownerDocument.createElement("style");
    sheet.dataset.pageFlow = `section-layout-${++nextSectionSheet}`;
    view.dom.parentElement!.setAttribute(
      "data-page-flow",
      sheet.dataset.pageFlow,
    );
    view.dom.ownerDocument.head.append(sheet);
    sectionSheets.set(view, sheet);
  }
  if (sheet) {
    const scope = `[data-page-flow="${sheet.dataset.pageFlow}"] > .ProseMirror`;
    const css = widths
      .map(
        ({ from, to, style }) =>
          `${scope} > :nth-child(n+${from} of :not(.ProseMirror-widget)):nth-child(-n+${to} of :not(.ProseMirror-widget)){${style}}`,
      )
      .join("\n");
    if (sheet.textContent !== css) sheet.textContent = css;
  }
  layoutExactLeading(view, invalidate);
  layoutTabs(view, invalidate);
  let decorations = DecorationSet.empty;
  if (plainProse && previous && endDiff && diff != null) {
    const from = Math.min(diff,endDiff.a,endDiff.b);
    decorations = previous.decorations.map(new Mapping([new StepMap([from,endDiff.a-from,endDiff.b-from])]),doc);
  }
  const cellAlignment = tableAlignmentBase(doc);
  const mergedRows = mergedTableRows(doc);
  let rowHeights: Decoration[] = [];
  let alignedCells: Decoration[] = [];
  let inlineImages: HTMLElement[] = [];
  let textBoxes: {from:number;to:number;element:HTMLElement}[] = [];
  let inlineImageRects: DOMRect[] | undefined;
  const fixedKeys = !previous ? new Map((flowCache.get(view)?.spacers || []).filter(spacer=>!spacer.row&&!spacer.nodeSize).map(spacer=>[spacer.pos,spacer.key])) : new Map<number,string|undefined>();
  const render = () => {
    inlineImageRects = undefined;
    const painted = [...spacers,...futureSpacers];
    for (const spacer of painted) spacer.key ||= fixedKeys.get(spacer.pos) || `page-${nextSpacerKey++}`;
    const desired = [
      ...cellAlignment.decorations, ...alignedCells,
      ...painted
        .filter(
          (spacer) =>
            !spacer.nodeSize &&
            !spacer.row &&
            hasDiscretionaryBreak(doc, spacer.pos),
        )
        .map((spacer) =>
          Decoration.widget(
            spacer.pos,
            () => {
              const element = document.createElement("span");
              element.className = "discretionary-hyphen";
              element.dataset.discretionaryHyphen = "true";
              element.setAttribute("aria-hidden", "true");
              element.textContent = "-";
              return element;
            },
            {
              side: -2,
              key: `hyphen-${spacer.key}`,
              ignoreSelection: true,
            },
          ),
        ),
      ...painted.map((spacer) =>
        spacer.nodeSize
          ? Decoration.node(spacer.pos, spacer.pos + spacer.nodeSize, {
              style: `height: ${spacer.height}px; margin: 0; padding: 0; border: 0;`,
            })
          : Decoration.widget(
              spacer.pos,
              () => {
                const element = document.createElement(
                  spacer.row ? "tr" : "span",
                );
                element.className = "pagination-spacer";
                element.style.height = `${spacer.height}px`;
                element.setAttribute("aria-hidden", "true");
                if (spacer.row) {
                  element.style.display = "table-row";
                  const cell = document.createElement("td");
                  let columns = 0;
                  doc.nodeAt(spacer.pos)?.forEach((node) => {
                    columns += Number(node.attrs.colspan || 1);
                  });
                  cell.colSpan = Math.max(1, columns);
                  cell.style.cssText = `height:${spacer.height}px;padding:0;border:0;`;
                  element.append(cell);
                }
                return element;
              },
              {
                side: -1,
                key: `${spacer.key}-${spacer.height}`,
                ignoreSelection: true,
              },
            ),
      ),
    ];
    if (plainProse) {
      // Retain the decoration tree for untouched paragraphs, as well as their
      // DOM widgets. Rebuilding the tree defeats ProseMirror's subtree reuse
      // when it combines these spacers with thousands of hyphenation marks.
      const existing = decorations.find(), byKey = new Map(existing.map(item=>[item.spec.key,item]));
      const retained = new Set<Decoration>(), added:Decoration[]=[];
      for (const item of desired) {
        const old = byKey.get(item.spec.key);
        if (old && old.from===item.from && old.to===item.to) retained.add(old);
        else added.push(item);
      }
      decorations = decorations.remove(existing.filter(item=>!retained.has(item))).add(doc,added);
    } else decorations = DecorationSet.create(doc,desired);
    const base = decorations;
    decorations = base.add(doc, [...rowHeights]);
    apply(decorations);
    if (mergedRows.length && !alignedCells.length) {
      const inset = pageInsets(layout);
      rowHeights = mergedRowHeights(
        view, mergedRows,
        view.dom.getBoundingClientRect().width / (layout.width - inset.left - inset.right),
      );
      decorations = base.add(doc, [...rowHeights]);
      apply(decorations);
    }
  };
  if (spacers.length || futureSpacers.length || cellAlignment.decorations.length || mergedRows.length) render();
  else apply(DecorationSet.empty);
  // Removing spacers can clamp/anchor the scroll position. Measure against
  // the current editor origin, never a viewport coordinate captured earlier.
  const rootTop = () => view.dom.getBoundingClientRect().top;
  const root = view.dom.getBoundingClientRect();
  // Include the application's UI scale as well as the page zoom.
  const margins = pageInsets(layout);
  const scale = root.width / (layout.width - margins.left - margins.right);
  const pitch = layout.height + PAGE_GAP;
  let bodyHeight =
    currentLayout.height -
    pageInsets(currentLayout).top -
    pageInsets(currentLayout).bottom;
  const bodyTop = () =>
    hasSections
      ? frames[page].top + pageInsets(currentLayout).top - margins.top
      : page * pitch;
  const y = (pos: number) => {
    const box=textBoxes.find(box=>pos>=box.from&&pos<box.to);
    const rect = box ? (box.element.dataset.imageWrap !== "none" ? view.coordsAtPos(box.to,1) : box.element.getBoundingClientRect()) : view.coordsAtPos(pos, 1);
    let top = rect.top,
      bottom = rect.bottom;
    if (inlineImages.length) {
      inlineImageRects ??= inlineImages.map((image) =>
        image.getBoundingClientRect(),
      );
      // A text caret beside a picture reports glyph bounds, not the picture's
      // full line box. Pagination must move the whole line, including its top.
      for (const image of inlineImageRects) {
        if (rect.bottom > image.top + 0.5 && rect.top < image.bottom - 0.5) {
          top = Math.min(top, image.top);
          bottom = Math.max(bottom, image.bottom);
        }
      }
    }
    return {
      top: (top - rootTop()) / scale,
      bottom: (bottom - rootTop()) / scale,
    };
  };
  let page = hasSections ? frames.length - 1 : retained;
  let parallelTable = false;
  let parallelInsets = {top:0,bottom:0};
  let parallelHeader: FlowHeader[] | undefined;
  const splitTables: { from: number; to: number }[] = [];
  const starts = [
    0,
    ...(hasSections
      ? prefix.map((page) => page.from)
      : spacers.map((spacer) => spacer.pos)),
  ];
  const regionHeight=(index:number)=>{
    const current=frames[index]?.layout||layout,inset=pageInsets(current);
    let height=current.height-inset.top-inset.bottom;
    for(const limit of layout.columnLimits||[]){
      const first=starts.findIndex(start=>start>=limit.from);
      if(starts[index]>=limit.from&&starts[index]<limit.to&&(limit.regions==null||index<first+limit.regions))height=Math.min(height,limit.height);
    }
    height -= layout.pageReserves?.[index] || 0;
    return Math.max(1,height - (parallelTable ? parallelInsets.bottom : 0));
  };
  bodyHeight=regionHeight(page);
  const nextPage = (
    pos: number,
    top: number,
    nodeSize?: number,
    row = false,
    header?: FlowHeader[],
    nextLayout?: PageLayout,
    parity?: "oddPage" | "evenPage",
    restartNumber?: number | null,
  ) => {
    header ||= parallelTable ? parallelHeader : undefined;
    const topInset=parallelTable && !(row&&header?.at(-1)?.table!==parallelHeader?.at(-1)?.table)?parallelInsets.top:0;
    const reuseParallelPage = parallelTable && page + 1 < starts.length;
    if (hasSections && !reuseParallelPage) {
      const addFrame = (next: PageLayout) => {
        const prior = frames.at(-1)!;
        frames.push({
          top: prior.top + prior.layout.height + PAGE_GAP,
          left: (canvasWidth - next.width) / 2,
          layout: next,
        });
      };
      // A parity page is physically present, but contains no authored text.
      const numbering = sectionNumbering(
        frames.length +
          ((pendingLayout || currentLayout).pageNumberOffset ??
            layout.firstPageNumber ??
            1),
        layout.columnSource ? "nextPage" : parity || "nextPage",
        restartNumber,
      );
      if (numbering.blank) {
        addFrame(currentLayout);
        page++;
        starts.push(pos);
      }
      currentLayout = nextLayout || pendingLayout || currentLayout;
      pendingLayout = undefined;
      if (nextLayout)
        currentLayout = {
          ...currentLayout,
          pageNumberOffset: numbering.number - frames.length,
          sectionStartPage: frames.length,
        };
      addFrame(currentLayout);
      const inset = pageInsets(currentLayout);
      bodyHeight = currentLayout.height - inset.top - inset.bottom;
    }
    page++;
    if (reuseParallelPage) starts[page] = Math.min(starts[page], pos);
    else starts.push(pos);
    bodyHeight=regionHeight(page);
    const spacer: PageSpacer = {
      pos,
      height: Math.max(0, bodyTop() + tableHeaderHeight(header) + topInset - top),
      nodeSize,
      row,
      header,
    };
    spacers.push(spacer);
    render();
    // Inline widgets split a line box. Correct for its actual browser height.
    if (!nodeSize) {
      const actualTop = row
        ? ((view.nodeDOM(pos) as HTMLElement).getBoundingClientRect().top -
            rootTop()) /
          scale
        : y(pos).top;
      const correction = bodyTop() + tableHeaderHeight(header) + topInset - actualTop;
      if (Math.abs(correction) > 0.5) {
        spacer.height = Math.max(0, spacer.height + correction);
        render();
      }
    }
    // Identical unchanged boundary and gap means the remainder has stabilised.
    // Reuse its measured spacers (mapped by the document-size delta) in one pass.
    if (!parallelTable && previous && endDiff && pos > endDiff.b) {
      const delta = endDiff.b - endDiff.a;
      const oldIndex = previous.spacers.findIndex(
        (old) => old.pos === pos - delta,
      );
      const old = previous.spacers[oldIndex];
      const oldPage = hasSections
        ? (pageAtPosition(previous.pages, pos - delta) ?? 0)
        : oldIndex + 1;
      const oldFrame = previous.pages[oldPage]?.frame;
      const sameSection =
        !hasSections ||
        (oldFrame &&
          (!(hasNumberRestarts || hasContinuous) || oldPage === page) &&
          oldPage % 2 === page % 2 &&
          JSON.stringify({ ...oldFrame.layout, zoom: 1 }) ===
            JSON.stringify({ ...currentLayout, zoom: 1 }));
      if (
        old &&
        sameSection &&
        old.nodeSize === nodeSize &&
        !!old.row === row &&
        JSON.stringify(old.header)===JSON.stringify(header) &&
        Math.abs(old.height - spacer.height) < 0.25
      ) {
        futureSpacers = [];
        const tail = previous.spacers.slice(oldIndex + 1).map((old) => ({
          ...old,
          pos: old.pos + delta,
          ...(old.header
            ? {
                header: old.header.map(item=>({
                  ...item,
                  table:
                    item.table >= endDiff.a
                      ? item.table + delta
                      : item.table,
                })),
              }
            : {}),
        }));
        spacers.push(...tail);
        if (hasContinuous)
          continuousStates.push(
            ...(previous.continuousStates || [])
              .filter((state) => state.pos > pos - delta)
              .map((state) => ({ ...state, pos: state.pos + delta })),
          );
        if (hasSections) {
          const offset = frames[page].top - oldFrame!.top;
          const suffix = previous.pages.slice(oldPage + 1);
          starts.push(...suffix.map((item) => item.from + delta));
          frames.push(
            ...suffix.map((item) => ({
              ...item.frame!,
              top: item.frame!.top + offset,
            })),
          );
          page += suffix.length;
        } else {
          starts.push(...tail.map((item) => item.pos));
          page += tail.length;
        }
        if (tail.length) render();
        stable = true;
      }
    }
  };
  const visit = (node: PMNode, pos: number): boolean | undefined => {
    if (stable || pos + node.nodeSize <= restart) return false;
    if (futureSpacers.length && node.isTextblock) {
      const remaining = futureSpacers.filter(spacer=>spacer.pos<pos||spacer.pos>=pos+node.nodeSize);
      if (remaining.length !== futureSpacers.length) {
        futureSpacers = remaining;
        render();
      }
    }
    if (node.type.name === "table") {
      const enclosing = { parallel: parallelTable, insets: parallelInsets, header: parallelHeader };
      const ownHeaders = (rows: number, height: number): FlowHeader[] => [
        ...(enclosing.header || []),
        {
          table: pos, rows, height,
          offset: enclosing.parallel ? tableHeaderHeight(enclosing.header) + enclosing.insets.top : 0,
        },
      ];
      const map = TableMap.get(node);
      // Ordinary rows and complete vertical-merge groups can move together.
      // Oversized groups retain the existing line splitting fallback.
      if (map.problems?.length) return;
      let headerRows = 0;
      while (
        headerRows < node.childCount &&
        node.child(headerRows).childCount &&
        Array.from({ length: node.child(headerRows).childCount }, (_, i) =>
          node.child(headerRows).child(i),
        ).every((cell) => cell.type.name === "table_header")
      )
        headerRows++;
      if (!tableRowBoundary(map, headerRows)) headerRows = 0;
      const positions: number[] = [];
      node.forEach((_row, offset) => positions.push(pos + 1 + offset));
      const bounds = (row: number) =>
        (view.nodeDOM(positions[row]) as HTMLElement).getBoundingClientRect();
      const headerHeight = headerRows
        ? (bounds(headerRows - 1).bottom - bounds(0).top) / scale
        : 0;
      const parallelCells = parallelCellStories(node);
      const groups: { row: number; end: number }[] = [];
      for (let row = 0; row < node.childCount; ) {
        let end = row + 1;
        while (!tableRowBoundary(map, end)) end++;
        // Keep all header rows with at least the first complete body row group.
        if (!row && headerRows && headerRows < node.childCount) {
          end = Math.max(end, headerRows + 1);
          while (!tableRowBoundary(map, end)) end++;
        }
        groups.push({ row, end });
        row = end;
      }
      if (
        headerRows &&
        groups[0]?.end > headerRows &&
        ((bounds(groups[0].end - 1).bottom - bounds(0).top) / scale >
          bodyHeight ||
          (parallelCells && node.child(headerRows).attrs.allowSplit === true))
      ) {
        const end = groups[0].end;
        const bodyGroups: { row: number; end: number }[] = [];
        for (let row = headerRows; row < end;) {
          let to = row + 1;
          while (!tableRowBoundary(map, to)) to++;
          bodyGroups.push({ row, end: to });
          row = to;
        }
        groups.splice(0, 1, { row: 0, end: headerRows }, ...bodyGroups);
      }
      const oversized = groups.some(
        ({ row, end }) =>
          (bounds(end - 1).bottom - bounds(row).top) / scale > bodyHeight,
      );
      // Parallel cell flows share physical pages but have separate document
      // intervals, including the separate stories of vertically merged rows.
      const splittable =
        (oversized ||
          Array.from({ length: node.childCount }, (_, i) => node.child(i)).some(
            (row) => row.attrs.allowSplit === true,
          )) &&
        parallelCells;
      if (oversized && !splittable) return;
      if (splittable) splitTables.push({ from: pos, to: pos + node.nodeSize });
      // An allowed split must not strand a header at the bottom of the sheet.
      // Reserve the first body line in each cell before dividing that row.
      if (
        splittable &&
        headerRows &&
        groups[0].end === headerRows &&
        headerRows < node.childCount
      ) {
        let firstLineBottom = 0;
        node.child(headerRows).forEach((_cell, offset) => {
          firstLineBottom = Math.max(
            firstLineBottom,
            y(positions[headerRows] + 3 + offset).bottom,
          );
        });
        const headerTop = (bounds(0).top - rootTop()) / scale;
        if (
          firstLineBottom > bodyTop() + bodyHeight &&
          firstLineBottom - headerTop <= bodyHeight &&
          headerTop > bodyTop() + 1
        )
          nextPage(positions[0], headerTop, undefined, true);
      }
      for (const { row, end } of groups) {
        if (stable) break;
        const first = bounds(row),
          last = bounds(end - 1);
        const height = (last.bottom - first.top) / scale;
        const repeatingHeader =
          row >= headerRows && headerRows && headerHeight < bodyHeight / 2
            ? ownHeaders(headerRows,headerHeight)
            : enclosing.header;
        const availableHeight = bodyHeight - tableHeaderHeight(repeatingHeader);
        const overflow =
          (last.bottom - rootTop()) / scale > bodyTop() + bodyHeight + 0.5;
        if (
          splittable &&
          row >= headerRows &&
          (height > availableHeight ||
            (node.child(row).attrs.allowSplit === true && overflow))
        ) {
          const firstPage = page;
          let lastPage = page;
          parallelTable = true;
          parallelHeader = repeatingHeader;
          for (let cellRow = row; cellRow < end; cellRow++) {
            const rowNode = node.child(cellRow), rowStart = positions[cellRow];
            rowNode.forEach((cell, cellOffset) => {
              const element = view.nodeDOM(rowStart + 1 + cellOffset) as HTMLElement;
              const style = getComputedStyle(element);
              parallelInsets = {
                top: (parseFloat(style.paddingTop) || 0) + (parseFloat(style.borderTopWidth) || 0) / 2 +
                  (enclosing.parallel && repeatingHeader?.at(-1)?.table !== pos ? enclosing.insets.top : 0),
                bottom: (parseFloat(style.paddingBottom) || 0) + (parseFloat(style.borderBottomWidth) || 0) / 2 +
                  (enclosing.parallel ? enclosing.insets.bottom : 0),
              };
              page = firstPage;
              const top = y(rowStart + 3 + cellOffset).top;
              // A later row in the same merge group can begin on an existing
              // continuation page. Its story must start on that physical page.
              while (page + 1 < starts.length && top >= (hasSections
                ? frames[page + 1].top + pageInsets(frames[page + 1].layout).top - margins.top
                : (page + 1) * pitch) - .5) page++;
              if (hasSections) currentLayout = frames[page].layout;
              bodyHeight = regionHeight(page);
              const walk = (child: PMNode, position: number) => {
                if (visit(child, position) !== false)
                  child.forEach((nested, offset) => walk(nested, position + 1 + offset));
              };
              cell.forEach((child, offset) => walk(child, rowStart + 2 + cellOffset + offset));
              lastPage = Math.max(lastPage, page);
            });
          }
          page = lastPage;
          if (hasSections) currentLayout = frames[page].layout;
          parallelTable = enclosing.parallel;
          parallelInsets=enclosing.insets;
          bodyHeight=regionHeight(page);
          parallelHeader = enclosing.header;
          continue;
        }
        const repeat =
          row >= headerRows && headerRows && height + headerHeight <= bodyHeight
            ? ownHeaders(headerRows,headerHeight)
            : enclosing.header;
        if (
          (last.bottom - rootTop()) / scale > bodyTop() + bodyHeight + 0.5 &&
          (first.top - rootTop()) / scale > bodyTop() + 1
        )
          nextPage(
            positions[row],
            (first.top - rootTop()) / scale,
            undefined,
            true,
            repeat,
          );
      }
      return false;
    }
    if (node.type.name === "table_row") {
      const element = view.nodeDOM(pos) as HTMLElement;
      const rect = element.getBoundingClientRect();
      if (rect.height / scale <= bodyHeight) {
        if ((rect.bottom - rootTop()) / scale > bodyTop() + bodyHeight)
          nextPage(pos, (rect.top - rootTop()) / scale, undefined, true);
        return false;
      }
    }
    if (node.type.name === "section_break") {
      const element = view.nodeDOM(pos) as HTMLElement;
      const inherited = pendingLayout || currentLayout;
      const nextLayout: PageLayout = {
        ...sectionLayout(inherited, node.attrs.page),
        runningMatter:
          node.attrs.runningMatter || inherited.runningMatter
            ? resolveRunningMatter(
                inherited.runningMatter ||
                  defaultRunningMatter({
                    header: inherited.header,
                    footer: inherited.footer,
                  } as Project["settings"]),
                node.attrs.runningMatter,
              )
            : undefined,
        runningSectionId: node.attrs.blockId,
        pageNumberFormat:
          node.attrs.numberingFormat ?? inherited.pageNumberFormat,
      };
      if (
        node.attrs.kind === "continuous" &&
        !layout.columnSource &&
        Math.abs(nextLayout.width - currentLayout.width) < 0.01 &&
        Math.abs(nextLayout.height - currentLayout.height) < 0.01
      ) {
        // Word keeps the current sheet's running stories, vertical margins and
        // page label. New horizontal margins already apply via block widths;
        // the remaining section settings take effect at the next sheet.
        pendingLayout = {
          ...nextLayout,
          sectionStartPage: page,
          pageNumberOffset:
            node.attrs.numberingStart != null
              ? node.attrs.numberingStart - page
              : inherited.pageNumberOffset,
        };
        continuousStates.push({ pos, page, layout: pendingLayout });
        return false;
      }
      nextPage(
        pos,
        (element.getBoundingClientRect().top - rootTop()) / scale,
        node.nodeSize,
        false,
        undefined,
        nextLayout,
        node.attrs.kind === "oddPage" || node.attrs.kind === "evenPage"
          ? node.attrs.kind
          : undefined,
        node.attrs.numberingStart,
      );
      return false;
    }
    if (node.type.name === "page_break" || node.type.name === 'column_break') {
      const element = view.nodeDOM(pos) as HTMLElement | null;
      const top = element
        ? (element.getBoundingClientRect().top - rootTop()) / scale
        : y(pos).top;
      nextPage(pos, top, node.nodeSize);
      return false;
    }
    if (node.isTextblock) {
      inlineImages = [];
      textBoxes=[];
      const wrappedImages: HTMLElement[] = [];
      inlineImageRects = undefined;
      node.forEach((child, offset) => {
        if (["inline_image","text_box","equation"].includes(child.type.name)) {
          const image = view.nodeDOM(pos + offset + 1);
          if(["text_box","equation"].includes(child.type.name) && image instanceof HTMLElement)textBoxes.push({from:pos+offset+1,to:pos+offset+1+child.nodeSize,element:image});
          if (image instanceof HTMLElement)
            (child.attrs.wrap && child.attrs.wrap !== 'none' ? wrappedImages : inlineImages).push(image);
        }
      });
      let from = pos + 1;
      const end = pos + node.nodeSize - 1;
      const element = view.nodeDOM(pos) as HTMLElement;
      const flow = getComputedStyle(element);
      const paragraphTop = () => Math.min(y(pos + 1).top, ...wrappedImages.map(image => (image.getBoundingClientRect().top - rootTop()) / scale));
      if (flow.breakBefore === "page" && pos > starts[page])
        nextPage(pos + 1, paragraphTop());
      if (wrappedImages.length) {
        const bottom = Math.max(...wrappedImages.map(image => (image.getBoundingClientRect().bottom - rootTop()) / scale));
        const top = paragraphTop();
        // The picture travels with its paragraph anchor. A float's height must
        // not turn every adjacent text line into one giant inline line box.
        if (bottom > bodyTop() + bodyHeight + .5 && bottom - top <= bodyHeight && top > bodyTop() + 1)
          nextPage(pos, top);
      }
      const paragraphHeight = y(end).bottom - paragraphTop();
      let keepBottom = y(end).bottom;
      if (flow.breakAfter === "avoid") {
        const resolved = doc.resolve(pos);
        let nextPosition = pos + node.nodeSize;
        for (
          let index = resolved.index() + 1;
          index < resolved.parent.childCount;
          index++
        ) {
          const next = resolved.parent.child(index);
          if (!next.isTextblock || next.type.name === "page_break") break;
          const nextDOM = view.nodeDOM(nextPosition) as HTMLElement | null;
          if (!nextDOM) break;
          const nextFlow = getComputedStyle(nextDOM);
          if (nextFlow.breakBefore === "page") break;
          const first = y(nextPosition + 1);
          keepBottom =
            nextFlow.breakInside === "avoid" || nextFlow.breakAfter === "avoid"
              ? y(nextPosition + next.nodeSize - 1).bottom
              : Math.min(
                  y(nextPosition + next.nodeSize - 1).bottom,
                  first.bottom +
                    (Number(nextFlow.orphans) > 1
                      ? first.bottom - first.top
                      : 0),
                );
          if (
            nextFlow.breakAfter !== "avoid" ||
            keepBottom - paragraphTop() > bodyHeight
          )
            break;
          nextPosition += next.nodeSize;
        }
      }
      if (
        pos > starts[page] &&
        ((flow.breakInside === "avoid" &&
          paragraphHeight <= bodyHeight &&
          y(end).bottom > bodyTop() + bodyHeight) ||
          (flow.breakAfter === "avoid" &&
            keepBottom - paragraphTop() <= bodyHeight &&
            keepBottom > bodyTop() + bodyHeight))
      )
        nextPage(pos + 1, paragraphTop());
      const lineStart = (position: number, lower: number) => {
        const top = y(position).top;
        let low = lower,
          high = position;
        while (low < high) {
          const mid = (low + high) >>> 1;
          if (y(mid).top < top - 0.5) low = mid + 1;
          else high = mid;
        }
        return low;
      };
      while (!stable && from <= end) {
        const limit = bodyTop() + bodyHeight;
        const forced = layout.pageMinimums?.find(item=>item.pos>=from&&item.pos<=end&&item.page>page);
        if (y(end).bottom <= limit + 0.5 && !forced) break;
        // Find the first visual line that no longer fits on this page.
        let lo = from,
          hi = end;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (y(mid).bottom > limit + 0.5) hi = mid;
          else lo = mid + 1;
        }
        const forcedLine = forced ? lineStart(forced.pos, from) : null;
        const forcedBreak = forcedLine != null && (y(end).bottom<=limit+0.5 || forcedLine<=lo);
        if (forcedBreak) lo=forcedLine!;
        // Keep at least two lines at either side of a split when possible.
        // Oversized paragraphs still split; the rules must never cause a loop.
        if (
          !forcedBreak && Number(flow.widows) > 1 &&
          lo > from &&
          Math.abs(y(end).top - y(lo).top) < 0.5
        )
          lo = lineStart(lo - 1, from);
        if (
          !forcedBreak && Number(flow.orphans) > 1 &&
          lo > from &&
          Math.abs(y(lo - 1).top - y(from).top) < 0.5
        )
          lo = from;
        const top = y(lo).top;
        // A single oversized line cannot fit on any page. Avoid endless reflow.
        if (top >= bodyTop() - 0.5 && y(lo).bottom - top > bodyHeight) break;
        if (!forcedBreak && lo === from && from <= starts[page] + 1) {
          // A forced minimum cannot fit on a fresh page. Fall back to the
          // original first overflowing line, which guarantees progress.
          let low = from,
            high = end;
          while (low < high) {
            const mid = (low + high) >>> 1;
            if (y(mid).bottom > limit + 0.5) high = mid;
            else low = mid + 1;
          }
          lo = low;
          if (lo === from) break;
        }
        if (lo > from && /[\uDC00-\uDFFF]/.test(doc.textBetween(lo, lo + 1)))
          lo--;
        // A break before the first character belongs outside its paragraph.
        // An inline spacer at that point consumes the native first line and
        // loses hanging/first-line indentation (including bibliography tabs).
        if(lo===pos+1)nextPage(pos,paragraphTop());
        else nextPage(lo, y(lo).top);
        from = forcedBreak && page < forced!.page ? lo : lo + 1;
      }
      inlineImages = [];
      textBoxes=[];
      inlineImageRects = undefined;
      return false;
    }
    if (node.isBlock && node.isLeaf) {
      const element = view.nodeDOM(pos) as HTMLElement | null;
      if (element) {
        const rect = element.getBoundingClientRect();
        const top = (rect.top - rootTop()) / scale;
        if (
          (rect.bottom - rootTop()) / scale > bodyTop() + bodyHeight &&
          top > bodyTop() + 1
        )
          nextPage(pos, top);
      }
      return false;
    }
  };
  doc.descendants(visit);
  const sectionStarts = [0];
  if (hasSections)
    doc.forEach((node, pos) => {
      if (node.type.name === "section_break") sectionStarts.push(pos);
    });
  let section = 0;
  let pages: FlowPage[] = starts.map((from, i) => {
    while (
      section + 1 < sectionStarts.length &&
      sectionStarts[section + 1] <= from
    )
      section++;
    return {
      from,
      to: starts[i + 1] ?? doc.content.size,
      text: doc.textBetween(from, starts[i + 1] ?? doc.content.size, "\n"),
      ...(layout.columnSource?{columnHeight:regionHeight(i)}:{}),
      ...(hasSections ? { frame: frames[i], section } : {}),
    };
  });
  for (const spacer of spacers) {
    if (!spacer.header?.length) continue;
    const node = view.nodeDOM(spacer.pos);
    const top = node instanceof HTMLElement ? (node.getBoundingClientRect().top - rootTop()) / scale : y(spacer.pos).top;
    const index = pageAtY(pages, top + margins.top, layout);
    const headers = pages[index].header ??= [];
    for (const header of spacer.header)
      if (!headers.some(item => item.table === header.table && item.offset === header.offset)) headers.push(header);
  }
  if (splitTables.length)
    pages = tablePageFragments(view, layout, pages, splitTables);
  if(cellAlignment.rows.length){alignedCells=alignedTableCells(view,cellAlignment.rows,pages,layout,scale);render();}
  const renderedPages = withRunningHeadings(doc, pages, layout);
  flowCache.set(view, {
    doc,
    key,
    spacers,
    pages,
    renderedPages,
    decorations,
    continuousStates,
  });
  return renderedPages;
}

/** Moving a physical page freezes the displayed boundaries as explicit breaks.
 * cut() preserves nested containers, inline marks, images and table structure.
 */
export function rearrangePages(
  doc: PMNode,
  pages: FlowPage[],
  from: number,
  to: number,
): PMNode {
  if (from === to) return doc;
  if (pages.some((page) => !contiguousPage(page)))
    throw new Error(
      "Move paragraphs or sentences on pages containing split table cells. These pages cannot move as a single document range.",
    );
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= pages.length ||
    to >= pages.length
  )
    throw new Error("Choose an existing page.");
  if (
    pages[0]?.from !== 0 ||
    pages.at(-1)?.to !== doc.content.size ||
    pages.some((p, i) => p.to < p.from || (i > 0 && p.from !== pages[i - 1].to))
  )
    throw new Error(
      "The page layout changed. Wait for pagination before arranging pages.",
    );
  // Keep section boundaries and their geometry in place. Moving complete pages
  // between different sections needs an explicit policy for the destination's
  // layout; paragraphs and sentences can already move freely between them.
  const ranges = [{ from: 0, to: doc.content.size }];
  doc.forEach((node, pos) => {
    if (node.type.name !== "section_break") return;
    ranges.at(-1)!.to = pos;
    ranges.push({ from: pos + node.nodeSize, to: doc.content.size });
  });
  const rangeForPage = (index: number) =>
    ranges.find(
      (range) =>
        pages[index].to > pages[index].from &&
        pages[index].to > range.from &&
        pages[index].from < range.to,
    );
  const range = rangeForPage(from);
  if (!range || range !== rangeForPage(to))
    throw new Error(
      "Pages can move within their section. Move paragraphs or sentences to another section.",
    );
  const indices = pages.flatMap((_, index) =>
    rangeForPage(index) === range ? [index] : [],
  );
  const chunks = indices.map((index) =>
    doc.cut(
      Math.max(pages[index].from, range.from),
      Math.min(pages[index].to, range.to),
    ),
  );
  chunks.splice(
    indices.indexOf(to),
    0,
    chunks.splice(indices.indexOf(from), 1)[0],
  );
  const nodes: PMNode[] = [];
  chunks.forEach((chunk, i) => {
    const content: PMNode[] = [];
    chunk.forEach((n) => content.push(n));
    while (content[0]?.type.name === "page_break") content.shift();
    while (content.at(-1)?.type.name === "page_break") content.pop();
    if (i) nodes.push(doc.type.schema.nodes.page_break.create());
    nodes.push(
      ...(content.length
        ? content
        : [doc.type.schema.nodes.paragraph.create()]),
    );
  });
  const result = doc.replace(
    range.from,
    range.to,
    new Slice(Fragment.from(nodes), 0, 0),
  );
  result.check();
  return result;
}
