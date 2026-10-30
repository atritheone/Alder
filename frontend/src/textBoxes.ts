import type { NodeSpec } from "prosemirror-model";
import { NodeSelection, type Command } from "prosemirror-state";
import { closeHistory } from "prosemirror-history";
import { imageWrapping, imageWrapStyle } from "./imageWrapping";
import { anchorPictures } from "./imageAnchors";
import type { DocNode } from "./types";

export const textBoxDefaults = {
  width: 240,
  minHeight: 48,
  padding: 8,
  borderWidth: 1,
  borderColor: "#253f60",
  fill: "#ffffff",
  color: "#000000",
  fontFamily: "Cambria",
  fontSize: 12,
  lineHeight: 1.2,
  align: "left",
  wrap: "none",
  wrapGap: 12,
};
export function textBoxProperties(value: Record<string, any>) {
  const result = { ...textBoxDefaults, ...value };
  for (const [key, min, max] of [
    ["width", 24, 2000],
    ["minHeight", 0, 2000],
    ["padding", 0, 96],
    ["borderWidth", 0, 12],
    ["fontSize", 6, 72],
    ["lineHeight", 1, 3],
  ] as const) {
    if (
      typeof result[key] !== "number" ||
      !Number.isFinite(result[key]) ||
      result[key] < min ||
      result[key] > max
    )
      throw new Error(`Invalid text box ${key}.`);
  }
  if (result.width <= 2 * (result.padding + result.borderWidth))
    throw new Error("The text box needs room for its text.");
  for (const key of ["borderColor", "fill", "color"] as const)
    if (!/^#[\da-f]{6}$/i.test(result[key]))
      throw new Error("Choose a text box colour.");
  if (!/^[\p{L}\p{N} _.,-]{1,100}$/u.test(result.fontFamily))
    throw new Error("Invalid text box font.");
  if (!["left", "center", "right", "justify"].includes(result.align))
    throw new Error("Invalid text box alignment.");
  imageWrapping(result);
  return result;
}
export function validTextBoxContent(content: DocNode[] = []) {
  return content.every(
    (n) =>
      ["text", "hard_break"].includes(n.type) &&
      !n.content &&
      (!n.marks ||
        n.marks.every((m) =>
          [
            "strong",
            "em",
            "underline",
            "strike",
            "subscript",
            "superscript",
            "text_style",
            "link",
            "revision_insertion",
            "revision_deletion",
            "revision_format",
          ].includes(m.type),
        )),
  );
}
export function textBoxStyle(value: Record<string, any>) {
  const a = textBoxProperties(value);
  return `display:inline-block;box-sizing:border-box;vertical-align:top;max-width:100%;width:${a.width}px;min-height:${a.minHeight}px;padding:${a.padding}px;border:${a.borderWidth}px solid ${a.borderColor};background:${a.fill};color:${a.color};font-family:'${a.fontFamily}';font-size:${a.fontSize}pt;line-height:${a.lineHeight};text-align:${a.align};text-indent:0;white-space:pre-wrap;overflow-wrap:anywhere;${imageWrapStyle(a)}`;
}
export const textBoxSpec: NodeSpec = {
  inline: true,
  group: "inline",
  content: "(text|hard_break)*",
  atom: true,
  draggable: true,
  marks: "_",
  attrs: Object.fromEntries(
    Object.entries({ ...textBoxDefaults, blockId: null }).map(
      ([key, value]) => [key, { default: value }],
    ),
  ),
  parseDOM: [
    {
      tag: "span[data-text-box]",
      priority: 100,
      getAttrs: (element) => {
        try {
          return textBoxProperties(
            JSON.parse(element.getAttribute("data-text-box")!),
          );
        } catch {
          return false;
        }
      },
    },
  ],
  toDOM: (node) => [
    "span",
    {
      "data-text-box": JSON.stringify(node.attrs),
      "data-object-id": node.attrs.blockId,
      "data-image-wrap": node.attrs.wrap,
      style: textBoxStyle(node.attrs),
      class: "text-box",
      contenteditable: "false",
      role: "group",
      "aria-label": "Text box",
    },
    0,
  ],
};
export function putTextBox(
  attrs: Record<string, any>,
  content: DocNode[],
  id?: string,
): Command {
  return (state, dispatch) => {
    if (!validTextBoxContent(content)) return false;
    let values: ReturnType<typeof textBoxProperties>;
    try {
      values = textBoxProperties(attrs);
    } catch {
      return false;
    }
    const tr = closeHistory(state.tr);
    let pos = -1;
    if (id)
      state.doc.descendants((node, at) => {
        if (node.type.name === "text_box" && node.attrs.blockId === id)
          pos = at;
      });
    if (id && pos < 0) return false;
    const node = state.schema.nodes.text_box.create(
      { ...values, blockId: id || `box_${crypto.randomUUID()}` },
      content.map((n) => state.schema.nodeFromJSON(n)),
    );
    if (id) tr.replaceWith(pos, pos + state.doc.nodeAt(pos)!.nodeSize, node);
    else {
      tr.replaceSelectionWith(node);
      tr.doc.descendants((n, at) => {
        if (n.attrs.blockId === node.attrs.blockId) pos = at;
      });
    }
    if (pos < 0) return false;
    tr.setSelection(NodeSelection.create(tr.doc, pos));
    dispatch?.(anchorPictures(tr).scrollIntoView());
    return true;
  };
}
