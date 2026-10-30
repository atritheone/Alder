import type { Node as PMNode, NodeSpec, Fragment } from "prosemirror-model";
import { TextSelection, type Command } from "prosemirror-state";
import { closeHistory } from "prosemirror-history";

export const validBookmarkName = (name: unknown): name is string =>
  typeof name === "string" && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name);
export const bookmarkSpec: NodeSpec = {
  inline: true,
  group: "inline",
  atom: true,
  selectable: false,
  marks: "",
  attrs: {
    name: { default: "" },
    blockId: { default: null },
    range: { default: false },
  },
  parseDOM: [
    {
      tag: "span[data-document-bookmark]",
      getAttrs: (dom) =>
        validBookmarkName(dom.getAttribute("data-document-bookmark"))
          ? {
              name: dom.getAttribute("data-document-bookmark"),
              range: dom.getAttribute("data-bookmark-range") === "true",
              blockId: /^[A-Za-z0-9_.-]{1,128}$/.test(
                dom.getAttribute("data-bookmark-id") || "",
              )
                ? dom.getAttribute("data-bookmark-id")
                : null,
            }
          : false,
    },
  ],
  toDOM: (node) => [
    "span",
    {
      "data-document-bookmark": node.attrs.name,
      "data-bookmark-id": node.attrs.blockId,
      "data-bookmark-range": node.attrs.range ? "true" : null,
      class: "document-bookmark",
      title: `Bookmark: ${node.attrs.name}`,
      "aria-label": `Bookmark: ${node.attrs.name}`,
      contenteditable: "false",
    },
  ],
};
export const bookmarkEndSpec: NodeSpec = {
  inline: true,
  group: "inline",
  atom: true,
  selectable: false,
  marks: "",
  attrs: {
    targetId: { default: "" },
    name: { default: "" },
    blockId: { default: null },
  },
  parseDOM: [
    {
      tag: "span[data-bookmark-end]",
      getAttrs: (dom) =>
        /^[A-Za-z0-9_.-]{1,128}$/.test(
          dom.getAttribute("data-bookmark-end") || "",
        )
          ? {
              targetId: dom.getAttribute("data-bookmark-end"),
              name: dom.getAttribute("data-bookmark-name") || "",
            }
          : false,
    },
  ],
  toDOM: (node) => [
    "span",
    {
      "data-bookmark-end": node.attrs.targetId,
      "data-bookmark-name": node.attrs.name,
      class: "document-bookmark document-bookmark-end",
      title: `End of bookmark: ${node.attrs.name}`,
      "aria-label": `End of bookmark: ${node.attrs.name}`,
      contenteditable: "false",
    },
  ],
};
/** A copied fragment's own links follow its new destinations. Links pointing
 * outside the copied fragment continue to refer to their original targets. */
export function copiedBookmarkTargets(fragment: Fragment) {
  const nodes = new Map<PMNode, string>(),
    links = new Map<string, string>();
  const complete = new Set<string>();
  fragment.descendants((node) => {
    if (
      !["bookmark", "heading", "image", "inline_image", "table", "index_entry", "document_note"].includes(
        node.type.name,
      ) &&
      !node.attrs.captionLabel
    )
      return;
    const id = `block_${crypto.randomUUID()}`;
    nodes.set(node, id);
    for (const target of [
      node.attrs.blockId,
      node.type.name === "bookmark" ? node.attrs.name : null,
    ])
      if (target && !links.has(target)) links.set(target, id);
  });
  fragment.descendants((node) => {
    if (node.type.name === "bookmark_end" && links.has(node.attrs.targetId))
      complete.add(node.attrs.targetId);
  });
  return { nodes, links, complete };
}
export function documentBookmarks(doc: PMNode) {
  const found: {
    id: string;
    name: string;
    pos: number;
    context: string;
    end?: number;
    incomplete?: boolean;
    missingStart?: boolean;
  }[] = [];
  const ends = new Map<string, { pos: number; name: string }[]>();
  doc.descendants((node, pos, parent) => {
    if (node.type.name === "bookmark")
      found.push({
        id: node.attrs.blockId,
        name: node.attrs.name,
        pos,
        context: parent?.textContent.slice(0, 120) || "",
        incomplete: !!node.attrs.range,
      });
    if (node.type.name === "bookmark_end")
      ends.set(node.attrs.targetId, [
        ...(ends.get(node.attrs.targetId) || []),
        { pos, name: node.attrs.name },
      ]);
  });
  for (const item of found) {
    const closing = ends.get(item.id);
    if (closing?.length === 1 && closing[0].pos > item.pos) {
      item.end = closing[0].pos;
      item.incomplete = false;
      item.context = doc
        .textBetween(item.pos + 1, Math.min(item.end, item.pos + 241), " ")
        .slice(0, 120);
    } else if (closing) item.incomplete = true;
    ends.delete(item.id);
  }
  for (const [id, closing] of ends)
    found.push({
      id,
      name: closing[0].name || "Incomplete bookmark",
      pos: closing[0].pos,
      context: "The start of this bookmark is missing.",
      incomplete: true,
      missingStart: true,
    });
  return found;
}
export function addDocumentBookmark(name: string): Command {
  return (state, dispatch) => {
    if (
      !validBookmarkName(name) ||
      !state.selection.$from.parent.canReplaceWith(
        state.selection.$from.index(),
        state.selection.$from.index(),
        state.schema.nodes.bookmark,
      ) ||
      (!state.selection.empty &&
        !state.selection.$to.parent.canReplaceWith(
          state.selection.$to.index(),
          state.selection.$to.index(),
          state.schema.nodes.bookmark_end,
        )) ||
      documentBookmarks(state.doc).some(
        (item) => item.name.toLowerCase() === name.toLowerCase(),
      )
    )
      return false;
    if (dispatch) {
      const id = `block_${crypto.randomUUID()}`,
        range = !state.selection.empty;
      const tr = closeHistory(state.tr);
      if (range)
        tr.insert(
          state.selection.to,
          state.schema.nodes.bookmark_end.create({
            targetId: id,
            name,
            blockId: `block_${crypto.randomUUID()}`,
          }),
        );
      tr.insert(
        state.selection.from,
        state.schema.nodes.bookmark.create({
          name,
          blockId: id,
          range,
        }),
      );
      tr.setSelection(
        range
          ? TextSelection.create(
              tr.doc,
              state.selection.from + 1,
              state.selection.to + 1,
            )
          : TextSelection.near(tr.doc.resolve(state.selection.from + 1)),
      );
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}
export function changeDocumentBookmark(
  id: string,
  name: string | null,
): Command {
  return (state, dispatch) => {
    const all = documentBookmarks(state.doc),
      current = all.find((item) => item.id === id);
    if (
      !current ||
      (name !== null &&
        (!validBookmarkName(name) ||
          all.some(
            (item) =>
              item.id !== id && item.name.toLowerCase() === name.toLowerCase(),
          )))
    )
      return false;
    if (dispatch) {
      const tr = closeHistory(state.tr);
      const matches: { pos: number; node: PMNode }[] = [];
      state.doc.descendants((node, pos) => {
        if (
          (node.type.name === "bookmark" && node.attrs.blockId === id) ||
          (node.type.name === "bookmark_end" && node.attrs.targetId === id)
        )
          matches.push({ pos, node });
      });
      for (const { pos, node } of matches.reverse()) {
        if (name === null) tr.delete(pos, pos + 1);
        else tr.setNodeMarkup(pos, undefined, { ...node.attrs, name });
      }
      dispatch(tr);
    }
    return true;
  };
}
export function goToDocumentBookmark(id: string): Command {
  return (state, dispatch) => {
    const item = documentBookmarks(state.doc).find((item) => item.id === id);
    if (!item) return false;
    dispatch?.(
      state.tr
        .setSelection(
          item.end != null
            ? TextSelection.create(state.doc, item.pos + 1, item.end)
            : TextSelection.near(state.doc.resolve(item.pos + 1)),
        )
        .scrollIntoView(),
    );
    return true;
  };
}
