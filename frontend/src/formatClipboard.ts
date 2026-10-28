import type { Mark, Node as PMNode } from "prosemirror-model";
import {
  TextSelection,
  type Command,
  type EditorState,
} from "prosemirror-state";
import { closeHistory } from "prosemirror-history";
import { paragraphProperties } from "./editorCommands";
import { headingFormatting } from "./documentFormatting";
import { resolveStyles } from "./styleResolution";
import type { NamedStyle, StyleProperties } from "./types";

const appearanceMarks = [
  "strong",
  "em",
  "underline",
  "strike",
  "subscript",
  "superscript",
  "highlight",
  "code",
  "text_style",
];
type CopiedFormat = {
  block: "paragraph" | "heading";
  level: number;
  paragraph: Record<string, unknown>;
  marks: { type: string; attrs?: Record<string, unknown> }[];
};
let clipboard: CopiedFormat | null = null;
export const hasCopiedFormatting = () => !!clipboard;

/** An app-local appearance snapshot. It contains no text, links or document IDs. */
export function captureFormatting(
  state: EditorState,
  styles: NamedStyle[] = [],
  defaults: StyleProperties = {},
): CopiedFormat | null {
  let block: PMNode | undefined;
  let marks: readonly Mark[] | undefined;
  state.doc.nodesBetween(
    state.selection.from,
    state.selection.to,
    (node, pos, parent) => {
      if (!block && ["paragraph", "heading"].includes(node.type.name))
        block = node;
      if (!marks && node.isText && parent === block && pos < state.selection.to)
        marks = node.marks;
    },
  );
  if (!block) return null;
  if (state.selection.empty)
    marks = state.storedMarks || state.selection.$from.marks();
  const resolved = resolveStyles(styles);
  const present = (attrs: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(attrs).filter(
        ([, value]) => value != null && value !== "",
      ),
    );
  const paragraph = {
    fontFamily: "Cambria",
    fontSize: 12,
    color: "#000000",
    align: "left",
    lineHeight: 1.6,
    spaceBefore: 0,
    spaceAfter: 9,
    leftIndent: 0,
    rightIndent: 0,
    firstLineIndent: 0,
    ...defaults,
    ...(block.type.name === "heading"
      ? headingFormatting(block.attrs.level)
      : {}),
    ...resolved.get(block.attrs.styleId),
    ...present(block.attrs),
  };
  if (block.attrs.firstLineIndent == null && block.attrs.indent != null)
    paragraph.firstLineIndent = block.attrs.indent;
  const textStyle =
    state.schema.marks.text_style.isInSet(marks || [])?.attrs || {};
  const character = {
    ...paragraph,
    ...resolved.get(textStyle.styleId),
    ...present(textStyle),
  };
  const copied = (marks || [])
    .filter(
      (mark) =>
        appearanceMarks.includes(mark.type.name) &&
        mark.type.name !== "text_style",
    )
    .map((mark) => mark.toJSON());
  if (
    block.type.name === "heading" &&
    !copied.some((mark) => mark.type === "strong")
  )
    copied.push({ type: "strong" });
  copied.push({
    type: "text_style",
    attrs: {
      fontFamily: character.fontFamily,
      fontSize: character.fontSize,
      color: character.color,
    },
  });
  return {
    block: block.type.name as CopiedFormat["block"],
    level: block.attrs.level || 1,
    paragraph: Object.fromEntries(
      [...paragraphProperties, "fontFamily", "fontSize", "color"].map((key) => [
        key,
        paragraph[key as keyof typeof paragraph] ?? null,
      ]),
    ),
    marks: copied,
  };
}

export function copyFormatting(
  state: EditorState,
  styles: NamedStyle[] = [],
  defaults: StyleProperties = {},
): boolean {
  const copied = captureFormatting(state, styles, defaults);
  if (!copied) return false;
  clipboard = copied;
  return true;
}

/** Partial text selections change character appearance only; whole paragraphs
 * and a caret also receive paragraph formatting. One transaction, one undo. */
export function pasteFormatting(copied = clipboard): Command {
  return (state, dispatch) => {
    if (!copied) return false;
    const { from, to, empty } = state.selection;
    const blocks: { node: PMNode; pos: number }[] = [];
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (["paragraph", "heading"].includes(node.type.name))
        blocks.push({ node, pos });
    });
    if (!blocks.length) return false;
    if (!dispatch) return true;
    const tr = closeHistory(state.tr);
    for (const { node, pos } of blocks) {
      if (!empty && (from > pos + 1 || to < pos + node.nodeSize - 1)) continue;
      let type = state.schema.nodes[copied.block];
      const $pos = state.doc.resolve(pos),
        index = $pos.index();
      if (!$pos.parent.canReplaceWith(index, index + 1, type)) type = node.type;
      tr.setNodeMarkup(pos, type, {
        ...node.attrs,
        ...copied.paragraph,
        styleId: null,
        indent: null,
        ...(type.name === "heading" ? { level: copied.level } : {}),
      });
    }
    const marks = copied.marks.map((mark) => state.schema.markFromJSON(mark));
    if (empty) {
      tr.setStoredMarks([
        ...(state.storedMarks || state.selection.$from.marks()).filter(
          (mark) => !appearanceMarks.includes(mark.type.name),
        ),
        ...marks,
      ]);
    } else {
      for (const { node, pos } of blocks) {
        const start = Math.max(from, pos + 1),
          end = Math.min(to, pos + node.nodeSize - 1);
        for (const name of appearanceMarks)
          tr.removeMark(start, end, state.schema.marks[name]);
        for (const mark of marks) tr.addMark(start, end, mark);
      }
      // Preserve the user's selection, including reverse selections, after type changes.
      if (state.selection instanceof TextSelection)
        tr.setSelection(
          TextSelection.create(
            tr.doc,
            state.selection.anchor,
            state.selection.head,
          ),
        );
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}
