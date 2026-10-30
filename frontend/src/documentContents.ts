import type { NodeSpec, Node as PMNode } from "prosemirror-model";
import { Plugin, type EditorState, NodeSelection } from "prosemirror-state";
import { closeHistory, isHistoryTransaction } from "prosemirror-history";
import type { DocNode } from "./types";
import { documentText } from "./textProjection";
import type { ReferenceIndex } from "./documentReferences";
import {refreshedIndex} from './documentIndex';

export type ContentsOptions = {
  kind?: "headings" | "figures" | "tables" | "index";
  title: string;
  depth: number;
  entryStyle: string | null;
  pageNumbers?: boolean;
};
export const contentsSpec: NodeSpec = {
  group: "block",
  content: "paragraph+",
  atom: true,
  isolating: true,
  draggable: true,
  attrs: {
    blockId: { default: null },
    title: { default: "Contents" },
    depth: { default: 3 },
    entryStyle: { default: null },
    pageNumbers: { default: true },
    kind: { default: "headings" },
  },
  parseDOM: [
    {
      tag: "div[data-document-contents]",
      getAttrs: (dom) => ({
        title: dom.getAttribute("data-contents-title") ?? "Contents",
        depth: Number(dom.getAttribute("data-contents-depth")) || 3,
        entryStyle: dom.getAttribute("data-contents-style") || null,
        pageNumbers: dom.getAttribute("data-contents-pages") !== "false",
        kind: dom.getAttribute("data-contents-kind") || "headings",
      }),
    },
  ],
  toDOM: (n) => [
    "div",
    {
      "data-document-contents": "true",
      "data-contents-title": n.attrs.title,
      "data-contents-depth": n.attrs.depth,
      "data-contents-style": n.attrs.entryStyle,
      "data-contents-pages": String(n.attrs.pageNumbers),
      "data-contents-kind": n.attrs.kind,
      class: "document-contents",
      contenteditable: "false",
      "aria-label": "Table of contents",
    },
    0,
  ],
};
export function validContentsOptions(value: ContentsOptions) {
  return (
    (value.kind == null ||
      ["headings", "figures", "tables", "index"].includes(value.kind)) &&
    (value.pageNumbers == null || typeof value.pageNumbers === "boolean") &&
    typeof value.title === "string" &&
    value.title.length <= 200 &&
    Number.isInteger(value.depth) &&
    value.depth >= 1 &&
    value.depth <= 6 &&
    (value.entryStyle == null ||
      (typeof value.entryStyle === "string" &&
        /^[A-Za-z0-9_.-]{1,128}$/.test(value.entryStyle)))
  );
}
const field = (
  targetId: string,
  text: string,
  referenceFormat = "text",
): DocNode => ({
  type: "cross_reference",
  attrs: { targetId, referenceFormat },
  content: [{ type: "text", text }],
});
/** Refresh only on request; stable target identities retain entry formatting. */
export function refreshedContents(
  node: DocNode,
  index: ReferenceIndex,
): DocNode {
  if (node.type !== "table_of_contents") {
    if (!node.content) return node;
    const content = node.content.map((child) =>
      refreshedContents(child, index),
    );
    return content.every((child, i) => child === node.content![i])
      ? node
      : { ...node, content };
  }
  const options = node.attrs as ContentsOptions;
  if (!validContentsOptions(options))
    throw new Error("Invalid table of contents settings.");
  if(options.kind==='index')return refreshedIndex(node,index.indexEntries);
  const previous = new Map(
    (node.content || []).flatMap((entry) => {
      const target = entry.content?.find((n) => n.type === "cross_reference")
        ?.attrs?.targetId;
      return target ? [[target, entry] as const] : [];
    }),
  );
  const content: DocNode[] = options.title
    ? [
        {
          type: "paragraph",
          attrs: { keepWithNext: true },
          content: [
            { type: "text", text: options.title, marks: [{ type: "strong" }] },
          ],
        },
      ]
    : [];
  const fallback = { ...previous.values().next().value?.attrs };
  delete fallback.blockId;
  for (const target of index.targets.values()) {
    const headings = !options.kind || options.kind === "headings";
    if (
      headings
        ? target.kind !== "heading" || (target.level || 1) > options.depth
        : target.kind !== "caption" ||
          target.captionLabel !==
            (options.kind === "figures" ? "Figure" : "Table")
    )
      continue;
    const text = index.resolve(target.id);
    if (!text) continue;
    const number = headings ? index.resolve(target.id, "number") : null,
      prior = previous.get(target.id);
    content.push({
      type: "paragraph",
      attrs: {
        ...(prior?.attrs || fallback),
        styleId: options.entryStyle,
        leftIndent: headings ? ((target.level || 1) - 1) * 12 : 0,
        keepWithNext: false,
        headingNumbered: false,
      },
      content: [
        ...(number
          ? [field(target.id, number, "number"), { type: "text", text: " " }]
          : []),
        field(target.id, text),
        ...(options.pageNumbers !== false
          ? [
              { type: "text", text: "\t" },
              field(
                target.id,
                documentText(
                  prior?.content?.find(
                    (n) =>
                      n.type === "cross_reference" &&
                      n.attrs?.referenceFormat === "page",
                  ) || { type: "text", text: "—" },
                ),
                "page",
              ),
            ]
          : []),
      ],
    });
  }
  if (!content.length || content.length === (options.title ? 1 : 0))
    content.push({
      type: "paragraph",
      content: [
        {
          type: "text",
          text:
            options.kind === "figures"
              ? "No figure captions available."
              : options.kind === "tables"
                ? "No table captions available."
                : "No headings available.",
        },
      ],
    });
  const next = { ...node, content };
  return JSON.stringify(next) === JSON.stringify(node) ? node : next;
}
export function selectedContents(state: EditorState): PMNode | null {
  if (
    state.selection instanceof NodeSelection &&
    state.selection.node.type.name === "table_of_contents"
  )
    return state.selection.node;
  for (let depth = state.selection.$from.depth; depth > 0; depth--)
    if (state.selection.$from.node(depth).type.name === "table_of_contents")
      return state.selection.$from.node(depth);
  return null;
}
export function insertContents(state: EditorState, node: DocNode) {
  const tr = state.tr;
  for (let depth = state.selection.$from.depth; depth > 0; depth--)
    if (state.selection.$from.node(depth).type.name === node.type) {
      tr.setSelection(
        NodeSelection.create(state.doc, state.selection.$from.before(depth)),
      );
      break;
    }
  return closeHistory(tr)
    .replaceSelectionWith(state.schema.nodeFromJSON(node))
    .scrollIntoView();
}
/** Generated prose can be moved/deleted as a whole, never partly rewritten. */
export const protectContents = () =>
  new Plugin({
    filterTransaction(tr, state) {
      if (
        !tr.docChanged ||
        isHistoryTransaction(tr) ||
        tr.getMeta("blockIdentities") ||
        tr.getMeta("referenceRefresh") ||
        tr.getMeta("contentsUpdate")
      )
        return true;
      let allowed = true;
      state.doc.descendants((node, pos) => {
        if (!["table_of_contents", "bibliography", "citation"].includes(node.type.name)) return;
        const from = tr.mapping.mapResult(pos, 1),
          to = tr.mapping.mapResult(pos + node.nodeSize, -1);
        if ((from.deletedAcross && to.deletedAcross) || to.pos <= from.pos)
          return false;
        const after = tr.doc.nodeAt(from.pos);
        if (
          after?.type === node.type &&
          after.attrs.blockId === node.attrs.blockId &&
          !after.eq(node)
        )
          allowed = false;
        return false;
      });
      return allowed;
    },
  });
