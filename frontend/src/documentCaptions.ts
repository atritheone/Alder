import type { NodeSpec } from "prosemirror-model";
import {
  TextSelection,
  type Command,
  type EditorState,
} from "prosemirror-state";
import { closeHistory } from "prosemirror-history";
import { splitBlock } from "prosemirror-commands";
import { selectedImage } from "./imageFormatting";
import { tableContext } from "./tableFormatting";
import type { DocNode, Project } from "./types";
import { documentText } from "./textProjection";

export type CaptionLabel = "Figure" | "Table";

/** Enter creates ordinary prose; the numbered half retains caption identity. */
export const splitCaption: Command = (state, dispatch) => {
  const original = state.selection.$from.parent;
  if (
    !original.attrs.captionLabel ||
    !state.selection.$from.sameParent(state.selection.$to)
  )
    return false;
  return splitBlock(
    state,
    dispatch &&
      ((tr) => {
        const right = tr.selection.$from;
        if (!right.depth) return;
        const rightPos = right.before(),
          left = tr.doc.resolve(rightPos).nodeBefore;
        const hasNumber = (node: import("prosemirror-model").Node) => {
          let found = false;
          node.forEach((child) => {
            if (
              child.type.name === "sequence" &&
              child.attrs.sequenceName === original.attrs.captionLabel
            )
              found = true;
          });
          return found;
        };
        const keepRight =
          hasNumber(right.parent) && (!left || !hasNumber(left));
        const ordinary = (attrs: Record<string, unknown>) => ({
          ...attrs,
          blockId: `block_${crypto.randomUUID()}`,
          captionLabel: null,
          captionTargetId: null,
          keepWithNext: null,
          keepTogether: null,
        });
        tr.setNodeMarkup(
          rightPos,
          undefined,
          keepRight
            ? { ...right.parent.attrs, ...original.attrs }
            : ordinary(right.parent.attrs),
        );
        if (left?.isTextblock)
          tr.setNodeMarkup(
            rightPos - left.nodeSize,
            undefined,
            keepRight
              ? ordinary(left.attrs)
              : { ...left.attrs, ...original.attrs },
          );
        dispatch(tr);
      }),
  );
};
export const sequenceSpec: NodeSpec = {
  inline: true,
  group: "inline",
  content: "text*",
  atom: true,
  attrs: { sequenceName: { default: "Figure" }, blockId: { default: null } },
  parseDOM: [
    {
      tag: "span[data-document-sequence]",
      getAttrs: (dom) =>
        ["Figure", "Table"].includes(
          dom.getAttribute("data-document-sequence") || "",
        )
          ? { sequenceName: dom.getAttribute("data-document-sequence") }
          : false,
    },
  ],
  toDOM: (node) => [
    "span",
    {
      "data-document-sequence": node.attrs.sequenceName,
      contenteditable: "false",
      title: "Caption number. Update fields refreshes numbering.",
    },
    0,
  ],
};

export function captionObject(state: EditorState) {
  const image = selectedImage(state);
  if (image) {
    const point = state.doc.resolve(image.pos);
    // An inline picture's caption sits outside its text paragraph.
    const pos = image.node.isInline ? point.before(point.depth) : image.pos;
    const node = state.doc.nodeAt(pos)!;
    return {
      id: image.node.attrs.blockId as string,
      pos,
      size: node.nodeSize,
      label: "Figure" as CaptionLabel,
    };
  }
  const table = tableContext(state);
  return table
    ? {
        id: table.table.attrs.blockId as string,
        pos: table.tableStart - 1,
        size: table.table.nodeSize,
        label: "Table" as CaptionLabel,
      }
    : null;
}

export function addCaption(
  id: string,
  label: CaptionLabel,
  title: string,
  position: "before" | "after",
  starts: Record<CaptionLabel, number> = { Figure: 0, Table: 0 },
): Command {
  return (state, dispatch) => {
    if (
      !["Figure", "Table"].includes(label) ||
      !title.trim() ||
      title.length > 1000
    )
      return false;
    let found: { pos: number; size: number } | null = null,
      existing = false;
    state.doc.descendants((node, pos) => {
      if (node.attrs.captionTargetId === id) existing = true;
      if (
        node.attrs.blockId === id &&
        ["image", "inline_image", "table"].includes(node.type.name)
      ) {
        const point = state.doc.resolve(pos);
        const at = node.isInline ? point.before(point.depth) : pos;
        found = { pos: at, size: state.doc.nodeAt(at)!.nodeSize };
      }
    });
    if (!found || existing) return false;
    const object = found as { pos: number; size: number };
    const at = object.pos + (position === "after" ? object.size : 0),
      resolved = state.doc.resolve(at);
    if (
      !resolved.parent.canReplaceWith(
        resolved.index(),
        resolved.index(),
        state.schema.nodes.paragraph,
      )
    )
      return false;
    if (dispatch) {
      const caption = state.schema.nodes.paragraph.create(
        {
          captionLabel: label,
          captionTargetId: id,
          blockId: `block_${crypto.randomUUID()}`,
          keepWithNext: position === "before",
          keepTogether: true,
        },
        [
          state.schema.text(label + " "),
          state.schema.nodes.sequence.create(
            { sequenceName: label, blockId: `block_${crypto.randomUUID()}` },
            state.schema.text("1"),
          ),
          state.schema.text(": " + title.trim()),
        ],
      );
      const tr = closeHistory(state.tr).insert(at, caption);
      const numbers = { ...starts };
      tr.doc.descendants((node, pos) => {
        if (node.type.name !== "sequence") return;
        const value = String(
          ++numbers[node.attrs.sequenceName as CaptionLabel],
        );
        if (node.textContent !== value)
          tr.replaceWith(
            tr.mapping.slice(1).map(pos + 1),
            tr.mapping.slice(1).map(pos + node.nodeSize - 1),
            state.schema.text(value),
          );
        return false;
      });
      tr.setSelection(
        TextSelection.near(
          tr.doc.resolve(tr.mapping.slice(1).map(at + caption.nodeSize - 1)),
        ),
      );
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export function numberedDocument(
  document: DocNode,
  counts: Record<CaptionLabel, number>,
): DocNode {
  if (document.type === "sequence") {
    const text = String(++counts[document.attrs!.sequenceName as CaptionLabel]);
    return documentText(document) === text
      ? document
      : { ...document, content: [{ type: "text", text }] };
  }
  if (!document.content) return document;
  const content = document.content.map((node) =>
    numberedDocument(node, counts),
  );
  return content.every((node, index) => node === document.content![index])
    ? document
    : { ...document, content };
}
export function numberProjectCaptions(project: Project) {
  const counts = { Figure: 0, Table: 0 };
  for (const chapter of project.book?.chapters || [])
    chapter.document = numberedDocument(
      chapter.document,
      chapter.include === false ? { Figure: 0, Table: 0 } : counts,
    );
  for (const clip of project.clips)
    for (const value of [clip, ...clip.variants])
      value.document = numberedDocument(value.document, {
        Figure: 0,
        Table: 0,
      });
}

const captionCounts = new WeakMap<DocNode, Record<CaptionLabel, number>>();
function sequenceCounts(node: DocNode): Record<CaptionLabel, number> {
  const cached = captionCounts.get(node);
  if (cached) return cached;
  const counts = { Figure: 0, Table: 0 };
  if (node.type === "sequence")
    counts[node.attrs!.sequenceName as CaptionLabel]++;
  for (const child of node.content || []) {
    const next = sequenceCounts(child);
    counts.Figure += next.Figure;
    counts.Table += next.Table;
  }
  captionCounts.set(node, counts);
  return counts;
}
export function chapterCaptionStarts(project: Project, id: string) {
  const counts = { Figure: 0, Table: 0 };
  for (const chapter of project.book?.chapters || []) {
    if (chapter.id === id)
      return chapter.include === false ? { Figure: 0, Table: 0 } : counts;
    if (chapter.include === false) continue;
    const next = sequenceCounts(chapter.document);
    counts.Figure += next.Figure;
    counts.Table += next.Table;
  }
  return counts;
}
