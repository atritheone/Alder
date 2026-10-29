import type { Node as PMNode } from "prosemirror-model";
import type { DocNode } from "./types";

export function documentText(node: DocNode): string {
  if (node.marks?.some((mark) => mark.type === "revision_deletion")) return "";
  if (node.type === "text") return node.text || "";
  if (["hardBreak", "hard_break"].includes(node.type)) return "\n";
  if (silent.has(node.type)) return "";
  return (node.content || [])
    .map(documentText)
    .join(
      ["tableRow", "table_row"].includes(node.type)
        ? "\t"
        : separated.has(node.type)
          ? "\n"
          : "",
    );
}

/** Exact UTF-16 text projection used by backend/alder/models.document_text.
 * map[n] is the ProseMirror boundary at text offset n, including empty blocks.
 */
export type TextProjection = { text: string; map: number[] };
const separated = new Set([
  "table_of_contents",
  "doc",
  "blockquote",
  "bullet_list",
  "bulletList",
  "ordered_list",
  "orderedList",
  "list_item",
  "listItem",
  "table",
  "table_cell",
  "tableCell",
  "table_header",
  "tableHeader",
]);
const silent = new Set([
  "revision_break",
  "comment_anchor",
  "bookmark",
  "bookmark_end",
  "image",
  "inline_image",
  "horizontal_rule",
  "horizontalRule",
  "page_break",
  "section_break",
  "pageBreak",
]);

function join(
  parts: TextProjection[],
  separator: string,
  emptyPosition: number,
): TextProjection {
  if (!parts.length) return { text: "", map: [emptyPosition] };
  const result = { text: parts[0].text, map: [...parts[0].map] };
  for (const part of parts.slice(1)) {
    if (separator) {
      result.text += separator + part.text;
      // The old last boundary is the start of the structural separator.
      // The next first boundary is its end, even when the next block is empty.
      for (const boundary of part.map) result.map.push(boundary);
    } else {
      result.text += part.text;
      result.map.pop();
      for (const boundary of part.map) result.map.push(boundary);
    }
  }
  return result;
}

// ProseMirror documents are immutable. Reuse their mapping across selection,
// highlighting and page updates instead of allocating one entry per character
// for every spoken word. Bound retention even when undo history holds old docs.
const projections = new Map<PMNode, TextProjection>();
export function projectText(doc: PMNode): TextProjection {
  const cached = projections.get(doc);
  if (cached) return cached;
  function visit(
    node: PMNode,
    position: number,
    isRoot = false,
  ): TextProjection {
    if (node.marks.some((mark) => mark.type.name === "revision_deletion"))
      return { text: "", map: [position + node.nodeSize] };
    if (node.isText) {
      const text = node.text || "";
      return {
        text,
        map: Array.from({ length: text.length + 1 }, (_, i) => position + i),
      };
    }
    const kind = node.type.name;
    if (kind === "hard_break" || kind === "hardBreak")
      return { text: "\n", map: [position, position + node.nodeSize] };
    if (silent.has(kind)) return { text: "", map: [position + node.nodeSize] };
    const contentStart = isRoot ? 0 : position + 1;
    const children: TextProjection[] = [];
    node.forEach((child, offset) =>
      children.push(visit(child, contentStart + offset)),
    );
    const separator =
      kind === "table_row" || kind === "tableRow"
        ? "\t"
        : separated.has(kind)
          ? "\n"
          : "";
    return join(children, separator, contentStart);
  }
  const projection = visit(doc, 0, true);
  if (projections.size >= 4)
    projections.delete(projections.keys().next().value!);
  projections.set(doc, projection);
  return projection;
}

function splitsSurrogate(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return false;
  const left = text.charCodeAt(offset - 1),
    right = text.charCodeAt(offset);
  return left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff;
}

export function selectionOffsets(doc: PMNode, from: number, to: number) {
  const { map } = projectText(doc);
  const offset = (position: number) => {
    let low = 0,
      high = map.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (map[middle] < position) low = middle + 1;
      else high = middle;
    }
    return Math.min(low, map.length - 1);
  };
  return { start: offset(from), end: offset(to) };
}

export function projectedRange(
  doc: PMNode,
  start: number,
  end: number,
  expectedText?: string,
  existingProjection?: TextProjection,
): { from: number; to: number } {
  const projection = existingProjection || projectText(doc);
  if (expectedText !== undefined && projection.text !== expectedText)
    throw new RangeError(
      "This result refers to earlier text. Run the check again.",
    );
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end > projection.text.length ||
    splitsSurrogate(projection.text, start) ||
    splitsSurrogate(projection.text, end)
  ) {
    throw new RangeError(
      "This text range is no longer valid. Run the check again.",
    );
  }
  const from = projection.map[start];
  let to = projection.map[end];
  // A zero-width bookmark at the end of a corrected word belongs after it,
  // rather than inside the replacement. Empty insertions retain right affinity.
  while (to > from) {
    const before = doc.resolve(to).nodeBefore;
    if (
      !before ||
      (!before.marks.some((mark) => mark.type.name === "revision_deletion") &&
        ![
          "bookmark",
          "bookmark_end",
          "comment_anchor",
          "inline_image",
        ].includes(before.type.name))
    )
      break;
    to -= before.nodeSize;
  }
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < from ||
    to > doc.content.size
  )
    throw new RangeError("This text range is outside the current document.");
  return { from, to };
}

/** A caret offset counts inline atoms; visible words do not. */
export function wordAtPosition(doc: PMNode, position: number) {
  const resolved = doc.resolve(position);
  if (!resolved.parent.isTextblock) return null;
  const parent = resolved.parent,
    start = resolved.start();
  const projection = projectText(parent),
    offset = position - start;
  let low = 0,
    high = projection.map.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (projection.map[middle] < offset) low = middle + 1;
    else high = middle;
  }
  const left =
    projection.text.slice(0, low).match(/[\p{L}\p{N}\u2019'-]+$/u)?.[0] || "";
  const right =
    projection.text.slice(low).match(/^[\p{L}\p{N}\u2019'-]+/u)?.[0] || "";
  if (!left && !right) return null;
  // projectedRange expects a complete document. Apply the parent's mapping
  // directly and keep a trailing point destination outside the word.
  const from = start + projection.map[low - left.length];
  let to = start + projection.map[low + right.length];
  while (to > from) {
    const before = doc.resolve(to).nodeBefore;
    if (
      !before ||
      (!before.marks.some((mark) => mark.type.name === "revision_deletion") &&
        ![
          "bookmark",
          "bookmark_end",
          "comment_anchor",
          "inline_image",
        ].includes(before.type.name))
    )
      break;
    to -= before.nodeSize;
  }
  return { from, to, text: left + right };
}
