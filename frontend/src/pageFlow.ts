import { Fragment, type Node as PMNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";

export type PageLayout = {
  width: number;
  height: number;
  margin: number;
  lineHeight: number;
  zoom: number;
};
export type FlowPage = { from: number; to: number; text: string };
export const PAGE_GAP = 28;

/** Read actual browser column boundaries, including paragraphs spanning pages.
 * Positions belong to this exact document snapshot, never to a word estimate.
 */
export function measurePages(view: EditorView, layout: PageLayout): FlowPage[] {
  const root = view.dom.getBoundingClientRect();
  const pitch = (layout.width + PAGE_GAP) * layout.zoom;
  const starts = new Map<number, number>([[0, 0]]);
  const column = (pos: number) =>
    Math.max(
      0,
      Math.floor((view.coordsAtPos(pos, 1).left - root.left + 1) / pitch),
    );
  view.state.doc.descendants((node, pos) => {
    if (!node.isText && !node.isLeaf && !node.isTextblock) return;
    if (node.isText) {
      const end = pos + node.nodeSize;
      let at = pos;
      while (at < end) {
        const page = column(at);
        if (!starts.has(page)) starts.set(page, at);
        if (column(end - 1) === page) break;
        let lo = at + 1,
          hi = end - 1;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (column(mid) > page) hi = mid;
          else lo = mid + 1;
        }
        // A boundary may not split the UTF-16 surrogate pair of a character.
        let next = lo;
        if (next > pos && /[\uDC00-\uDFFF]/.test(node.text![next - pos]))
          next--;
        // Browser caret geometry can report the two UTF-16 halves on opposite
        // sides of a wrap. Always advance, keeping the pair on one side.
        at = next > at ? next : lo + 1;
      }
    } else if (node.type.name !== "page_break") {
      const page = column(node.isTextblock ? pos + 1 : pos);
      if (!starts.has(page)) starts.set(page, pos);
    }
  });
  const max = Math.max(...starts.keys());
  const boundaries = Array.from(
    { length: max + 1 },
    (_, i) => starts.get(i) ?? starts.get(i + 1) ?? view.state.doc.content.size,
  );
  return boundaries.map((from, i) => ({
    from,
    to: boundaries[i + 1] ?? view.state.doc.content.size,
    text: view.state.doc.textBetween(
      from,
      boundaries[i + 1] ?? view.state.doc.content.size,
      "\n",
    ),
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
