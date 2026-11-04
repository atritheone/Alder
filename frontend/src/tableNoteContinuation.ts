import type { DocNode } from "./types";
import type { NoteProgress } from "./noteProgress";
import { documentText } from "./textProjection";
import { validListTemplate } from "./outlineLists";
import { repeatingTableHeaders } from "./repeatingTableHeaders";

const picture = (node: DocNode) =>
  ["image", "inline_image"].includes(node.type);
const allowed = new Set([
  "doc",
  "paragraph",
  "text",
  "hard_break",
  "image",
  "inline_image",
  "ordered_list",
  "bullet_list",
  "list_item",
  "table",
  "table_row",
  "table_cell",
  "table_header",
]);
type Origin = { from: number; images: number; paragraph: number };

/** Resume parallel cells independently. Only the derived story loses consumed
 * rows/content; the authored table, list settings and formatting stay intact. */
export function continueTableNote(source: DocNode, read: NoteProgress) {
  const consumed = new Map(read.paragraphs),
    pictures = new Set(read.pictures);
  const original = new Map<DocNode, Origin>(),
    derived = new Map<DocNode, Origin>();
  const touched = new Set<DocNode>(),
    hidden = new Set<DocNode>(),
    suppressed = new Set<DocNode>(),
    repeated = new Set<DocNode>();
  let paragraphIndex = 0,
    pictureIndex = 0;
  const index = (node: DocNode, from: number): boolean => {
    if (!allowed.has(node.type))
      throw new Error(
        "This footnote structure cannot continue across different page widths yet.",
      );
    if (node.attrs?.listTemplate && !validListTemplate(node.attrs.listTemplate))
      throw new Error("The footnote contains invalid outline numbering.");
    const origin = {
      from,
      images: pictureIndex,
      paragraph: node.type === "paragraph" ? paragraphIndex++ : -1,
    };
    original.set(node, origin);
    let changed = picture(node)
      ? pictures.has(pictureIndex++)
      : consumed.has(origin.paragraph);
    let at = from;
    node.content?.forEach((child, i) => {
      if (i && node.type !== "paragraph") at++;
      changed = index(child, at) || changed;
      at += documentText(child).length;
    });
    if (changed) touched.add(node);
    return changed;
  };
  index(source, 0);
  const empty = (node: DocNode) => {
    const result: DocNode = { type: "paragraph", content: [] };
    derived.set(result, { ...original.get(node)!, paragraph: -1 });
    hidden.add(result);
    return result;
  };
  const copy = (node: DocNode): DocNode => {
    const result = { ...node, content: node.content?.map(copy) };
    derived.set(result, original.get(node)!);
    repeated.add(result);
    return result;
  };
  const walk = (node: DocNode): DocNode | null => {
    const origin = original.get(node)!;
    if (picture(node)) {
      if (pictures.has(origin.images)) return null;
      derived.set(node, origin);
      return node;
    }
    if (node.type === "paragraph") {
      const through = consumed.get(origin.paragraph),
        content: DocNode[] = [];
      let first: Origin | undefined;
      for (const child of node.content || []) {
        const childOrigin = original.get(child)!;
        if (picture(child)) {
          const remaining = walk(child);
          if (remaining) {
            first ??= childOrigin;
            content.push(remaining);
          }
        } else if (
          through == null ||
          childOrigin.from + documentText(child).length > through
        ) {
          const skip = Math.max(
            0,
            (through ?? childOrigin.from) - childOrigin.from,
          );
          first ??= { ...childOrigin, from: childOrigin.from + skip };
          content.push(
            skip && child.type === "text"
              ? { ...child, text: child.text!.slice(skip) }
              : child,
          );
        }
      }
      if (!content.length && (node.content?.length || through != null))
        return null;
      const result = {
        ...node,
        attrs: {
          ...node.attrs,
          ...(touched.has(node) ? { firstLineIndent: 0, spaceBefore: 0 } : {}),
        },
        content,
      };
      derived.set(result, { ...origin, ...first, paragraph: origin.paragraph });
      return result;
    }
    if (node.type === "table") {
      const rows = node.content || [];
      const headerCount = repeatingTableHeaders(rows.map(row => (row.content || []).map(cell => ({ header: cell.type === "table_header", rowspan: Number(cell.attrs?.rowspan || 1) }))));
      const remaining: DocNode[] = [];
      for (let start = headerCount; start < rows.length; ) {
        let end = start + 1;
        for (let i = start; i < end; i++) {
          if (!rows[i])
            throw new Error(
              "The footnote contains an invalid vertical cell span.",
            );
          for (const cell of rows[i].content || [])
            end = Math.max(end, i + Number(cell.attrs?.rowspan || 1));
        }
        const group = rows
          .slice(start, end)
          .map((row) => ({
            row,
            cells: row.content || [],
            tails: (row.content || []).map(walk),
          }));
        // Keep the connected grid until every cell story in it is consumed.
        // Empty cells still own their span, borders and remaining row positions.
        if (group.some(({ tails }) => tails.some(Boolean)))
          for (const { row, cells, tails } of group)
            remaining.push({
              ...row,
              attrs: {
                ...row.attrs,
                ...(touched.has(row) ? { minHeight: null } : {}),
              },
              content: cells.map(
                (cell, i) => tails[i] || { ...cell, content: [empty(cell)] },
              ),
            });
        start = end;
      }
      if (!remaining.length) return null;
      const headings = rows
        .slice(0, headerCount)
        .map((row) => (touched.has(row) ? copy(row) : walk(row)!));
      return { ...node, content: [...headings, ...remaining] };
    }
    let first = -1;
    const content: DocNode[] = [];
    node.content?.forEach((child, i) => {
      const tail = walk(child);
      if (!tail) return;
      if (first < 0) first = i;
      content.push(tail);
    });
    if (!content.length) return null;
    if (node.type === "list_item") {
      if (content[0].type !== "paragraph") content.unshift(empty(node));
      if (touched.has(node)) suppressed.add(content[0]);
    }
    const result = {
      ...node,
      attrs: {
        ...node.attrs,
        ...(node.type === "ordered_list"
          ? {
              order: Number(node.attrs?.order || 1) + first,
              continuePrevious: false,
            }
          : {}),
        ...(["table_cell", "table_header"].includes(node.type) &&
        touched.has(node)
          ? { verticalAlign: "top" }
          : {}),
      },
      content,
    };
    return result;
  };
  const document = walk(source) || { ...source, content: [] };
  const offsets: number[] = [],
    imageStarts: number[] = [],
    paragraphOrigins: number[] = [],
    hiddenParagraphs: number[] = [],
    suppressedMarkers: number[] = [],
    repeatedParagraphs: number[] = [],
    repeatedPictures: number[] = [],
    pictureSources: { from: number; images: number }[] = [];
  const collect = (node: DocNode) => {
    if (node.type === "paragraph") {
      const i = offsets.length,
        origin = derived.get(node)!;
      offsets.push(origin.from);
      imageStarts.push(origin.images);
      paragraphOrigins.push(origin.paragraph);
      if (hidden.has(node)) hiddenParagraphs.push(i);
      if (suppressed.has(node)) suppressedMarkers.push(i);
      if (repeated.has(node)) repeatedParagraphs.push(i);
    }
    if (picture(node)) {
      if (repeated.has(node)) repeatedPictures.push(pictureSources.length);
      pictureSources.push(derived.get(node)!);
    }
    node.content?.forEach(collect);
  };
  collect(document);
  return {
    document,
    from: 0,
    images: 0,
    offsets,
    imageStarts,
    paragraphOrigins,
    hiddenParagraphs,
    suppressedMarkers,
    pictureSources,
    repeatedParagraphs,
    repeatedPictures,
  };
}
