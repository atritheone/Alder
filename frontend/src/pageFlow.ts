import { Fragment, Slice, type Node as PMNode } from "prosemirror-model";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { pageInsets, type PageGeometry } from "./pageGeometry";
import { TableMap } from "prosemirror-tables";
import { documentCanvasWidth, sectionLayout } from "./sectionLayout";
import { tableRowBoundary } from "./tableStructure";
import type { FlowHeader } from "./tablePageHeaders";

export type PageLayout = PageGeometry & {
  lineHeight: number;
  zoom: number;
  header?: string;
  footer?: boolean;
  firstPageNumber?: number;
  fontFamily?: string;
};
export type FlowPage = {
  from: number;
  to: number;
  text: string;
  header?: FlowHeader;
  section?: number;
  frame?: { top: number; left: number; layout: PageLayout };
};
export function pageAtPosition(
  pages: FlowPage[],
  position: number,
): number | null {
  if (!pages.length) return null;
  let low = 0,
    high = pages.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (pages[middle].from <= position) low = middle;
    else high = middle - 1;
  }
  return low;
}
export const PAGE_GAP = 28;
type PageSpacer = {
  pos: number;
  height: number;
  nodeSize?: number;
  row?: boolean;
  header?: FlowHeader;
};
type FlowCache = {
  doc: PMNode;
  key: string;
  spacers: PageSpacer[];
  pages: FlowPage[];
  decorations: DecorationSet;
};
const flowCache = new WeakMap<EditorView, FlowCache>();
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
  const hasSections = Array.from({ length: doc.childCount }, (_, i) =>
    doc.child(i),
  ).some((n) => n.type.name === "section_break");
  const canvasWidth = documentCanvasWidth(doc, layout);
  const key = JSON.stringify([
    layout.width,
    layout.height,
    pageInsets(layout),
    layout.lineHeight,
    view.dom.offsetWidth,
    canvasWidth,
    layout.header,
    layout.footer,
    layout.firstPageNumber,
    layout.fontFamily,
  ]);
  const candidate =
    !invalidate && flowCache.get(view)?.key === key
      ? flowCache.get(view)
      : undefined;
  // Display zoom is a transform; it cannot change the logical page map.
  if (candidate?.doc.eq(doc)) {
    apply(candidate.decorations);
    return candidate.pages;
  }
  const previous =
    hasSections !== !!candidate?.pages.some((page) => page.frame)
      ? undefined
      : candidate;
  const diff = previous?.doc.content.findDiffStart(doc.content);
  const endDiff = previous?.doc.content.findDiffEnd(doc.content);
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
        style = `position:relative;left:${left}px;width:${width}px;box-sizing:border-box;--page-width:${active.width}px;--page-height:${active.height}px;${Object.entries(
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
  let decorations = DecorationSet.empty;
  const render = () => {
    decorations = DecorationSet.create(doc, [
      ...spacers.map((spacer) =>
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
                key: `page-${spacer.pos}-${spacer.height}`,
                ignoreSelection: true,
              },
            ),
      ),
    ]);
    apply(decorations);
  };
  if (spacers.length) render();
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
    const rect = view.coordsAtPos(pos, 1);
    return {
      top: (rect.top - rootTop()) / scale,
      bottom: (rect.bottom - rootTop()) / scale,
    };
  };
  let page = hasSections ? frames.length - 1 : retained;
  const starts = [
    0,
    ...(hasSections
      ? prefix.map((page) => page.from)
      : spacers.map((spacer) => spacer.pos)),
  ];
  const nextPage = (
    pos: number,
    top: number,
    nodeSize?: number,
    row = false,
    header?: FlowHeader,
    nextLayout?: PageLayout,
    parity?: "oddPage" | "evenPage",
  ) => {
    if (hasSections) {
      const addFrame = (next: PageLayout) => {
        const prior = frames.at(-1)!;
        frames.push({
          top: prior.top + prior.layout.height + PAGE_GAP,
          left: (canvasWidth - next.width) / 2,
          layout: next,
        });
      };
      // A parity page is physically present, but contains no authored text.
      if (
        parity &&
        (frames.length + (layout.firstPageNumber ?? 1)) % 2 !==
          (parity === "oddPage" ? 1 : 0)
      ) {
        addFrame(currentLayout);
        page++;
        starts.push(pos);
      }
      currentLayout = nextLayout || currentLayout;
      addFrame(currentLayout);
      const inset = pageInsets(currentLayout);
      bodyHeight = currentLayout.height - inset.top - inset.bottom;
    }
    page++;
    starts.push(pos);
    const spacer = {
      pos,
      height: Math.max(0, bodyTop() + (header?.height || 0) - top),
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
      const correction = bodyTop() + (header?.height || 0) - actualTop;
      if (Math.abs(correction) > 0.5) {
        spacer.height = Math.max(0, spacer.height + correction);
        render();
      }
    }
    // Identical unchanged boundary and gap means the remainder has stabilised.
    // Reuse its measured spacers (mapped by the document-size delta) in one pass.
    if (previous && endDiff && pos > endDiff.b) {
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
          oldPage % 2 === page % 2 &&
          JSON.stringify({ ...oldFrame.layout, zoom: 1 }) ===
            JSON.stringify({ ...currentLayout, zoom: 1 }));
      if (
        old &&
        sameSection &&
        old.nodeSize === nodeSize &&
        !!old.row === row &&
        old.header?.rows === header?.rows &&
        old.header?.height === header?.height &&
        Math.abs(old.height - spacer.height) < 0.25
      ) {
        const tail = previous.spacers.slice(oldIndex + 1).map((old) => ({
          ...old,
          pos: old.pos + delta,
          ...(old.header
            ? {
                header: {
                  ...old.header,
                  table:
                    old.header.table >= endDiff.a
                      ? old.header.table + delta
                      : old.header.table,
                },
              }
            : {}),
        }));
        spacers.push(...tail);
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
  doc.descendants((node, pos) => {
    if (stable || pos + node.nodeSize <= restart) return false;
    if (node.type.name === "table") {
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
        groups.some(
          ({ row, end }) =>
            (bounds(end - 1).bottom - bounds(row).top) / scale > bodyHeight,
        )
      )
        return;
      for (const { row, end } of groups) {
        if (stable) break;
        const first = bounds(row),
          last = bounds(end - 1);
        const height = (last.bottom - first.top) / scale;
        const repeat =
          row >= headerRows && headerRows && height + headerHeight <= bodyHeight
            ? { table: pos, rows: headerRows, height: headerHeight }
            : undefined;
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
      nextPage(
        pos,
        (element.getBoundingClientRect().top - rootTop()) / scale,
        node.nodeSize,
        false,
        undefined,
        sectionLayout(layout, node.attrs.page),
        node.attrs.kind === "nextPage" ? undefined : node.attrs.kind,
      );
      return false;
    }
    if (node.type.name === "page_break") {
      const element = view.nodeDOM(pos) as HTMLElement | null;
      const top = element
        ? (element.getBoundingClientRect().top - rootTop()) / scale
        : y(pos).top;
      nextPage(pos, top, node.nodeSize);
      return false;
    }
    if (node.isTextblock) {
      let from = pos + 1;
      const end = pos + node.nodeSize - 1;
      const element = view.nodeDOM(pos) as HTMLElement;
      const flow = getComputedStyle(element);
      const paragraphTop = () => y(pos + 1).top;
      if (flow.breakBefore === "page" && pos > starts[page])
        nextPage(pos + 1, paragraphTop());
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
        if (y(end).bottom <= limit + 0.5) break;
        // Find the first visual line that no longer fits on this page.
        let lo = from,
          hi = end;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (y(mid).bottom > limit + 0.5) hi = mid;
          else lo = mid + 1;
        }
        // Keep at least two lines at either side of a split when possible.
        // Oversized paragraphs still split; the rules must never cause a loop.
        if (
          Number(flow.widows) > 1 &&
          lo > from &&
          Math.abs(y(end).top - y(lo).top) < 0.5
        )
          lo = lineStart(lo - 1, from);
        if (
          Number(flow.orphans) > 1 &&
          lo > from &&
          Math.abs(y(lo - 1).top - y(from).top) < 0.5
        )
          lo = from;
        const top = y(lo).top;
        // A single oversized line cannot fit on any page. Avoid endless reflow.
        if (top >= bodyTop() - 0.5 && y(lo).bottom - top > bodyHeight) break;
        if (lo === from && from <= starts[page] + 1) {
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
        nextPage(lo, y(lo).top);
        from = lo + 1;
      }
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
  });
  const headers = new Map(
    spacers
      .filter((spacer) => spacer.header)
      .map((spacer) => [spacer.pos, spacer.header]),
  );
  const sectionStarts = [0];
  if (hasSections)
    doc.forEach((node, pos) => {
      if (node.type.name === "section_break") sectionStarts.push(pos);
    });
  let section = 0;
  const pages = starts.map((from, i) => {
    while (
      section + 1 < sectionStarts.length &&
      sectionStarts[section + 1] <= from
    )
      section++;
    return {
      from,
      to: starts[i + 1] ?? doc.content.size,
      text: doc.textBetween(from, starts[i + 1] ?? doc.content.size, "\n"),
      ...(hasSections ? { frame: frames[i], section } : {}),
      ...(i > 0 && headers.get(from) ? { header: headers.get(from) } : {}),
    };
  });
  flowCache.set(view, { doc, key, spacers, pages, decorations });
  return pages;
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
