import type { Mark, Node as PMNode } from "prosemirror-model";
import type { Command, EditorState } from "prosemirror-state";
import { toggleMark, setBlockType } from "prosemirror-commands";
import { wrapInList, liftListItem } from "prosemirror-schema-list";
import { closeHistory } from "prosemirror-history";
import { resolveStyles } from "./styleResolution";
import type { NamedStyle, StyleProperties } from "./types";
import { headingFormatting } from "./documentFormatting";

export type SelectionFormatting = {
  block: string;
  fontFamily: string;
  fontSize: string;
  align: string;
  styleId: string;
  marks: Record<string, boolean | "mixed">;
  paragraph: Record<string, unknown>;
};
const characterMarks = [
  "strong",
  "em",
  "underline",
  "strike",
  "subscript",
  "superscript",
  "highlight",
  "code",
];
export const paragraphProperties = [
  "align",
  "lineHeight",
  "lineSpacing",
  "lineSpacingMode",
  "keepWithNext",
  "keepTogether",
  "widowOrphan",
  "pageBreakBefore",
  "spaceBefore",
  "spaceAfter",
  "leftIndent",
  "rightIndent",
  "firstLineIndent",
] as const;

/** Common values across the selection, including inherited style values. */
export function selectionFormatting(
  state: EditorState,
  styles: NamedStyle[] = [],
  defaults: StyleProperties = {},
): SelectionFormatting {
  let resolved: ReturnType<typeof resolveStyles> = new Map();
  try {
    resolved = resolveStyles(styles);
  } catch {
    /* The editor reports invalid styles. */
  }
  const blocks: PMNode[] = [],
    runs: { marks: readonly Mark[]; block: PMNode }[] = [];
  const { from, to, empty, $from } = state.selection;
  state.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (node.isTextblock) blocks.push(node);
    if (
      node.isInline &&
      parent?.isTextblock &&
      pos < to &&
      pos + node.nodeSize > from
    )
      runs.push({ marks: node.marks, block: parent });
  });
  if (!blocks.length && $from.parent.isTextblock) blocks.push($from.parent);
  if (empty && $from.parent.isTextblock)
    runs.splice(0, runs.length, {
      marks: state.storedMarks || $from.marks(),
      block: $from.parent,
    });
  const present = (values: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(values).filter(
        ([, v]) => v !== null && v !== undefined && v !== "",
      ),
    );
  const paragraph = (node: PMNode) => ({
    ...defaults,
    ...(node.type.name === "heading"
      ? headingFormatting(node.attrs.level)
      : {}),
    ...resolved.get(node.attrs.styleId),
    ...present(node.attrs),
  });
  const common = (values: unknown[]) =>
    values.length && values.every((v) => v === values[0]) ? values[0] : null;
  const textStyles = runs.map(({ marks, block }) => {
    const attrs = state.schema.marks.text_style?.isInSet(marks)?.attrs || {};
    return {
      ...paragraph(block),
      ...resolved.get(attrs.styleId),
      ...present(attrs),
    };
  });
  if (!textStyles.length) textStyles.push(...blocks.map(paragraph));
  return {
    block: String(
      common(
        blocks.map((b) =>
          b.type.name === "heading" ? String(b.attrs.level) : b.type.name,
        ),
      ) ?? "",
    ),
    styleId: String(common(blocks.map((b) => b.attrs.styleId || "")) ?? ""),
    fontFamily: String(common(textStyles.map((s) => s.fontFamily || "")) ?? ""),
    fontSize: String(common(textStyles.map((s) => s.fontSize || "")) ?? ""),
    align: String(
      common(blocks.map((b) => paragraph(b).align || "left")) ?? "",
    ),
    marks: Object.fromEntries(
      characterMarks.map((name) => {
        const values = runs.map(
          (r) => !!state.schema.marks[name]?.isInSet(r.marks),
        );
        return [
          name,
          values.length && values.some(Boolean)
            ? values.every(Boolean)
              ? true
              : "mixed"
            : false,
        ];
      }),
    ),
    paragraph: Object.fromEntries(
      paragraphProperties.map((key) => [
        key,
        common(blocks.map((b) => paragraph(b)[key])),
      ]),
    ),
  };
}

/** Change only the requested attributes, never copy a neighbouring run's marks. */
export function setTextStyle(attributes: Record<string, unknown>): Command {
  return (state, dispatch) => {
    const type = state.schema.marks.text_style;
    if (!type) return false;
    if (!dispatch) return true;
    const tr = closeHistory(state.tr),
      { from, to, empty } = state.selection;
    const apply = (marks: readonly Mark[], start?: number, end?: number) => {
      const attrs = { ...type.isInSet(marks)?.attrs, ...attributes };
      const hasValues = Object.values(attrs).some(
        (v) => v !== null && v !== undefined && v !== "",
      );
      if (start === undefined) {
        if (hasValues) tr.addStoredMark(type.create(attrs));
        else tr.removeStoredMark(type);
      } else {
        if (hasValues) tr.addMark(start, end!, type.create(attrs));
        else tr.removeMark(start, end!, type);
      }
    };
    if (empty) apply(state.storedMarks || state.selection.$from.marks());
    else
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.isInline)
          apply(
            node.marks,
            Math.max(from, pos),
            Math.min(to, pos + node.nodeSize),
          );
      });
    dispatch(tr);
    return true;
  };
}

export function setParagraph(attributes: Record<string, unknown>): Command {
  return (state, dispatch) => {
    const tr = closeHistory(state.tr);
    state.doc.nodesBetween(
      state.selection.from,
      state.selection.to,
      (node, pos) => {
        if (node.isTextblock)
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attributes });
      },
    );
    if (!tr.steps.length) return false;
    dispatch?.(tr);
    return true;
  };
}

export const clearCharacterFormatting: Command = (state, dispatch) => {
  const tr = closeHistory(state.tr);
  // Links carry document semantics and deliberately survive clearing appearance.
  for (const name of [...characterMarks, "text_style"]) {
    const type = state.schema.marks[name];
    if (!type) continue;
    if (state.selection.empty) tr.removeStoredMark(type);
    else tr.removeMark(state.selection.from, state.selection.to, type);
  }
  dispatch?.(tr);
  return true;
};

export function toggleList(name: "bullet_list" | "ordered_list"): Command {
  return (state, dispatch, view) => {
    const { $from } = state.selection;
    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth);
      if (["bullet_list", "ordered_list"].includes(node.type.name)) {
        if (node.type.name === name)
          return liftListItem(state.schema.nodes.list_item)(
            state,
            dispatch,
            view,
          );
        dispatch?.(
          state.tr.setNodeMarkup($from.before(depth), state.schema.nodes[name]),
        );
        return true;
      }
    }
    return wrapInList(state.schema.nodes[name])(state, dispatch, view);
  };
}

export type EditorCommand = {
  label: string;
  shortcut?: string;
  command: Command;
};
export function formattingCommands(
  state: EditorState,
): Record<string, EditorCommand> {
  const commands: Record<string, EditorCommand> = {
    clear: {
      label: "Clear character formatting",
      shortcut: "Mod-\\",
      command: clearCharacterFormatting,
    },
    resetParagraph: {
      label: "Reset paragraph formatting",
      command: setParagraph({
        ...Object.fromEntries(paragraphProperties.map((p) => [p, null])),
        indent: 0,
      }),
    },
    bullets: { label: "Bullet list", command: toggleList("bullet_list") },
    numbers: { label: "Numbered list", command: toggleList("ordered_list") },
  };
  for (const [name, label, shortcut] of [
    ["strong", "Bold", "Mod-b"],
    ["em", "Italic", "Mod-i"],
    ["underline", "Underline", "Mod-u"],
    ["strike", "Strikethrough"],
    ["subscript", "Subscript"],
    ["superscript", "Superscript"],
    ["highlight", "Highlight"],
  ])
    commands[name] = {
      label,
      shortcut,
      command: toggleMark(state.schema.marks[name]),
    };
  for (const alignment of ["left", "center", "right", "justify"])
    commands[alignment] = {
      label: `Align ${alignment}`,
      command: setParagraph({ align: alignment }),
    };
  commands.body = {
    label: "Body",
    command: setBlockType(state.schema.nodes.paragraph),
  };
  for (let level = 1; level <= 6; level++)
    commands[`heading${level}`] = {
      label: `Heading ${level}`,
      command: setBlockType(state.schema.nodes.heading, { level }),
    };
  return commands;
}
