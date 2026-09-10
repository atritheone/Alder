import type { Node as PMNode } from "prosemirror-model";

/** Exact UTF-16 text projection used by backend/alder/models.document_text.
 * map[n] is the ProseMirror boundary at text offset n, including empty blocks.
 */
export type TextProjection = { text: string; map: number[] };
const separated = new Set([
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
  "image",
  "horizontal_rule",
  "horizontalRule",
  "page_break",
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

export function projectText(doc: PMNode): TextProjection {
  function visit(
    node: PMNode,
    position: number,
    isRoot = false,
  ): TextProjection {
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
  return visit(doc, 0, true);
}

function splitsSurrogate(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return false;
  const left = text.charCodeAt(offset - 1),
    right = text.charCodeAt(offset);
  return left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff;
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
  const from = projection.map[start],
    to = projection.map[end];
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
