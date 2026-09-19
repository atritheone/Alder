import { Fragment, type Node as PMNode } from "prosemirror-model";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";

export type PageLayout = {
  width: number;
  height: number;
  margin: number;
  lineHeight: number;
  zoom: number;
};
export type FlowPage = { from: number; to: number; text: string };
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

/** Paginate one continuous editable document using layout-only spacers.
 * Nothing is inserted into the document or its undo/export history.
 */
export function paginatePages(
  view: EditorView,
  layout: PageLayout,
  apply: (decorations: DecorationSet) => void,
): FlowPage[] {
  const doc = view.state.doc;
  const spacers: {
    pos: number;
    height: number;
    nodeSize?: number;
    row?: boolean;
  }[] = [];
  const render = () =>
    apply(
      DecorationSet.create(
        doc,
        spacers.map((spacer) =>
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
      ),
    );
  apply(DecorationSet.empty);
  // Removing spacers can clamp/anchor the scroll position. Measure against
  // the current editor origin, never a viewport coordinate captured earlier.
  const rootTop = () => view.dom.getBoundingClientRect().top;
  const root = view.dom.getBoundingClientRect();
  // Include the application's UI scale as well as the page zoom.
  const scale = root.width / (layout.width - layout.margin * 2);
  const pitch = layout.height + PAGE_GAP;
  const bodyHeight = layout.height - 2 * layout.margin;
  const y = (pos: number) => {
    const rect = view.coordsAtPos(pos, 1);
    return {
      top: (rect.top - rootTop()) / scale,
      bottom: (rect.bottom - rootTop()) / scale,
    };
  };
  let page = 0;
  const starts = [0];
  const nextPage = (
    pos: number,
    top: number,
    nodeSize?: number,
    row = false,
  ) => {
    page++;
    starts.push(pos);
    const spacer = {
      pos,
      height: Math.max(0, page * pitch - top),
      nodeSize,
      row,
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
      const correction = page * pitch - actualTop;
      if (Math.abs(correction) > 0.5) {
        spacer.height = Math.max(0, spacer.height + correction);
        render();
      }
    }
  };
  doc.descendants((node, pos) => {
    if (node.type.name === "table_row") {
      const element = view.nodeDOM(pos) as HTMLElement;
      const rect = element.getBoundingClientRect();
      if (rect.height / scale <= bodyHeight) {
        if ((rect.bottom - rootTop()) / scale > page * pitch + bodyHeight)
          nextPage(pos, (rect.top - rootTop()) / scale, undefined, true);
        return false;
      }
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
      while (from <= end) {
        const limit = page * pitch + bodyHeight;
        if (y(end).bottom <= limit + 0.5) break;
        // Find the first visual line that no longer fits on this page.
        let lo = from,
          hi = end;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (y(mid).bottom > limit + 0.5) hi = mid;
          else lo = mid + 1;
        }
        const top = y(lo).top;
        // A single oversized line cannot fit on any page. Avoid endless reflow.
        if (top >= page * pitch - 0.5 && y(lo).bottom - top > bodyHeight) break;
        if (lo > from && /[\uDC00-\uDFFF]/.test(doc.textBetween(lo, lo + 1)))
          lo--;
        nextPage(lo, top);
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
          (rect.bottom - rootTop()) / scale > page * pitch + bodyHeight &&
          top > page * pitch + 1
        )
          nextPage(pos, top);
      }
      return false;
    }
  });
  return starts.map((from, i) => ({
    from,
    to: starts[i + 1] ?? doc.content.size,
    text: doc.textBetween(from, starts[i + 1] ?? doc.content.size, "\n"),
  }));
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
  const chunks = pages.map((p) => doc.cut(p.from, p.to));
  chunks.splice(to, 0, chunks.splice(from, 1)[0]);
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
  const result = doc.type.create(null, Fragment.from(nodes));
  result.check();
  return result;
}
