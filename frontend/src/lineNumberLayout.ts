import type { EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import type { FlowPage, PageLayout } from "./pageFlow";
import { pageFrame, pageAtY, sectionLayout } from "./sectionLayout";
import { pageInsets } from "./pageGeometry";
import { mirroredPageLayout } from "./mirroredMargins";
import { columnBreakRect } from "./columnLayout";
type Line = { page: number; column: number; x: number; y: number };
const cache = new WeakMap<
  EditorView,
  { doc: PMNode; pages: FlowPage[]; result: FlowPage[] }
>();
/** Read visual lines after columns, notes and mirrored margins settle. This
 * optional paint pass never writes into the editable tree or adds text nodes. */
export function numberedLines(
  view: EditorView,
  pages: FlowPage[],
  layout: PageLayout,
  invalidate = false,
): FlowPage[] {
  let enabled = !!layout.lineNumbering;
  view.state.doc.forEach((node) => {
    if (node.type.name === "section_break" && node.attrs.page?.lineNumbering)
      enabled = true;
  });
  if (!enabled) return pages;
  const previous = cache.get(view);
  if (
    !invalidate &&
    previous?.doc === view.state.doc &&
    previous.pages === pages
  )
    return previous.result;
  const canvas = view.dom.closest<HTMLElement>(".flow-canvas")!,
    origin = canvas.getBoundingClientRect(),
    scale = origin.width / parseFloat(canvas.style.width);
  const result = pages.map((page) => ({ ...page, lineNumbers: [] })),
    labels: NonNullable<FlowPage["lineNumbers"]>[] = result.map(
      (page) => page.lineNumbers,
    );
  const elements = new Map(
    [...view.dom.querySelectorAll<HTMLElement>("[data-block-id]")].map((el) => [
      el.dataset.blockId,
      el,
    ]),
  );
  const ctx = document.createElement("canvas").getContext("2d")!,
    metrics = new Map<string, number>();
  let current = layout,
    counter = layout.lineNumbering?.start || 1,
    lastPage = -1;
  const baseline = (element: Element) => {
    const css = getComputedStyle(element),
      font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
    if (!metrics.has(font)) {
      ctx.font = font;
      metrics.set(
        font,
        ctx.measureText("Mg").fontBoundingBoxAscent ||
          parseFloat(css.fontSize) * 0.8,
      );
    }
    return metrics.get(font)!;
  };
  const locate = (rect: DOMRect, ascent: number): Line => {
    const y = (rect.top - origin.top) / scale + ascent,
      index = Math.max(
        0,
        Math.min(pages.length - 1, pageAtY(pages, y, layout)),
      ),
      frame = pageFrame(pages, index, layout);
    const margins = pageInsets(
        mirroredPageLayout(
          { ...current, pageNumberOffset: frame.layout.pageNumberOffset },
          index,
        ),
      ),
      count = current.columns?.count || 1,
      gap = ((current.columns?.gapMm || 0) * 96) / 25.4,
      width =
        (current.width - margins.left - margins.right - gap * (count - 1)) /
        count;
    const left = (rect.left - origin.left) / scale - frame.left,
      column = Math.max(
        0,
        Math.min(
          count - 1,
          Math.floor((left - margins.left + gap / 2) / (width + gap)),
        ),
      );
    return {
      page: index,
      column,
      x: margins.left + column * (width + gap),
      y: y - frame.top,
    };
  };
  const emit = (line: Line, visible = true) => {
    const options = current.lineNumbering;
    if (!options) return;
    if (line.page !== lastPage && options.restart === "newPage")
      counter = options.start;
    lastPage = line.page;
    if (visible && counter % options.step === 0)
      labels[line.page].push({
        x: line.x - (options.distance * 4) / 3,
        y: line.y,
        number: counter,
        fontFamily: layout.fontFamily || "Cambria",
      });
    counter++;
  };
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === "section_break") {
      const next = sectionLayout(current, node.attrs.page),
        options = next.lineNumbering;
      if (
        options &&
        (!current.lineNumbering || options.restart !== "continuous")
      )
        counter = options.start;
      current = next;
      return false;
    }
    if (node.type.name === "table") return false;
    if (!current.lineNumbering) return;
    const element =
      elements.get(node.attrs.blockId) ||
      (view.nodeDOM(pos) as HTMLElement | null);
    if (!element) return;
    if (["page_break", "column_break"].includes(node.type.name)) {
      // Word's standalone break paragraph consumes a line even though the break
      // itself is not part of authored wording.
      const rect = element.getBoundingClientRect();
      const css = getComputedStyle(view.dom),
        font = parseFloat(css.fontSize),
        leading = parseFloat(css.lineHeight) || font * 1.2;
      emit(
        locate(
          rect,
          baseline(view.dom) + Math.max(0, leading - font * 1.2) / 2,
        ),
      );
      return false;
    }
    if (node.type.name === "image") {
      emit(locate(element.getBoundingClientRect(), baseline(element)));
      return false;
    }
    if (!node.isTextblock) return;
    if (
      getComputedStyle(element)
        .getPropertyValue("--suppress-line-numbers")
        .trim() === "1"
    )
      return false;
    const lines: Line[] = [],
      raised: (Line & { tolerance: number })[] = [];
    const add = (rect: DOMRect, ascent: number, parent: Element = element) => {
      if (rect.height <= 0) return;
      const line = locate(rect, ascent);
      const script = parent.closest("sup,sub");
      if (script && element.contains(script)) {
        raised.push({
          ...line,
          tolerance:
            parseFloat(getComputedStyle(script.parentElement!).fontSize) * 0.8,
        });
        return;
      }
      if (
        !lines.some(
          (old) =>
            old.page === line.page &&
            old.column === line.column &&
            // Font metrics and CSS glyph boxes round independently at a
            // fractional monitor scale. They can differ by a physical pixel.
            Math.abs(old.y - line.y) < 1.5,
        )
      )
        lines.push(line);
    };
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    );
    while (walker.nextNode()) {
      const item = walker.currentNode,
        parent =
          item.nodeType === Node.TEXT_NODE
            ? item.parentElement
            : (item as Element);
      if (
        !parent ||
        parent.closest(
          ".ProseMirror-widget,.structure-marker,.pagination-spacer,.discretionary-hyphen,[data-text-box]",
        )
      )
        continue;
      if (item.nodeType === Node.TEXT_NODE && item.textContent) {
        const range = document.createRange();
        range.selectNodeContents(item);
        for (const rect of range.getClientRects())
          add(rect, baseline(parent), parent);
      } else if (
        item.nodeType === Node.ELEMENT_NODE &&
        (item as Element).tagName === "BR"
      ) {
        const at = view.posAtDOM(item, 0),
          before = view.state.doc.resolve(at).nodeBefore;
        // A break ending a nonempty line is already represented by its text.
        // Its own CSS box may stay at the unprojected column position.
        if (!before || before.type.name === "hard_break")
          add(
            columnBreakRect(
              view,
              pos,
              at,
              (item as Element).getBoundingClientRect(),
              scale,
            ),
            baseline(parent),
            parent,
          );
      }
    }
    // Raised/lowered runs belong to the surrounding baseline. Do not count
    // them as separate lines, but retain a line consisting solely of a script.
    for (const line of raised) {
      if (
        !lines.some(
          (old) =>
            old.page === line.page &&
            old.column === line.column &&
            Math.abs(old.y - line.y) < line.tolerance,
        )
      )
        lines.push(line);
    }
    if (!lines.length) {
      const rect = view.coordsAtPos(pos + 1, 1);
      add(
        new DOMRect(
          rect.left,
          rect.top,
          rect.right - rect.left,
          rect.bottom - rect.top,
        ),
        baseline(element),
      );
    }
    lines
      .sort((a, b) => a.page - b.page || a.column - b.column || a.y - b.y)
      .forEach((line) => emit(line));
    return false;
  });
  cache.set(view, { doc: view.state.doc, pages, result });
  return result;
}
export function lineNumbersHTML(page: FlowPage) {
  const ns = "http://www.w3.org/2000/svg",
    svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "page-line-numbers");
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;overflow:hidden;pointer-events:none;user-select:none";
  for (const line of page.lineNumbers || []) {
    const text = document.createElementNS(ns, "text");
    for (const [k, v] of Object.entries({
      x: line.x,
      y: line.y,
      "font-size": 12,
      "font-family": line.fontFamily,
      "text-anchor": "end",
      fill: "#777777",
    }))
      text.setAttribute(k, String(v));
    text.textContent = String(line.number);
    svg.append(text);
  }
  return svg.outerHTML;
}
