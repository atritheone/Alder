import type { Node as PMNode, NodeSpec } from "prosemirror-model";
import { Plugin, TextSelection, type Command } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { closeHistory } from "prosemirror-history";
import type { DocNode } from "./types";

const summaryCache = new WeakMap<
  DocNode,
  { total: number; open: number; incomplete: number }
>();
export function commentSummary(document: DocNode) {
  const cached = summaryCache.get(document);
  if (cached) return cached;
  const threads = new Map<string, { edges: string[]; open: boolean }>();
  const walk = (node: DocNode) => {
    if (node.attrs?.revisionMove?.kind === 'deletion') return;
    if (node.type === "comment_anchor") {
      const id = node.attrs?.threadId;
      const item = threads.get(id) || {
        edges: [],
        open: !node.attrs?.thread?.resolved,
      };
      item.edges.push(node.attrs?.edge);
      threads.set(id, item);
    }
    node.content?.forEach(walk);
  };
  walk(document);
  const values = [...threads.values()];
  const result = {
    total: values.length,
    open: values.filter((item) => item.open).length,
    incomplete: values.filter((item) => item.edges.join(",") !== "start,end")
      .length,
  };
  summaryCache.set(document, result);
  return result;
}

export type CommentEntry = {
  id: string;
  author: string;
  text: string;
  date: string;
};
export type CommentThread = { entries: CommentEntry[]; resolved: boolean };
const identity = /^[A-Za-z0-9_.-]{1,128}$/;
export function validCommentThread(value: unknown): value is CommentThread {
  const thread = value as CommentThread;
  return (
    !!thread &&
    typeof thread.resolved === "boolean" &&
    Array.isArray(thread.entries) &&
    thread.entries.length > 0 &&
    thread.entries.length <= 1000 &&
    new Set(thread.entries.map((entry) => entry?.id)).size ===
      thread.entries.length &&
    thread.entries.every(
      (entry) =>
        !!entry &&
        identity.test(entry.id) &&
        typeof entry.author === "string" &&
        entry.author.length <= 200 &&
        typeof entry.text === "string" &&
        !!entry.text.trim() &&
        entry.text.length <= 10000 &&
        typeof entry.date === "string" &&
        entry.date.length <= 40 &&
        (entry.date === "" || Number.isFinite(Date.parse(entry.date))),
    )
  );
}
export const commentAnchorSpec: NodeSpec = {
  inline: true,
  group: "inline",
  atom: true,
  selectable: false,
  marks: "",
  attrs: {
    threadId: { default: "" },
    edge: { default: "start" },
    thread: { default: null },
    blockId: { default: null },
  },
  parseDOM: [
    {
      tag: "span[data-comment-thread]",
      // Selection decorations can leave an empty style attribute on the DOM.
      // The annotation must win over the generic styled-span mark parser.
      priority: 70,
      getAttrs: (dom) => {
        try {
          const thread = JSON.parse(
              dom.getAttribute("data-comment-content") || "null",
            ),
            threadId = dom.getAttribute("data-comment-thread"),
            edge = dom.getAttribute("data-comment-edge");
          return identity.test(threadId || "") &&
            ["start", "end"].includes(edge || "") &&
            validCommentThread(thread)
            ? { thread, threadId, edge }
            : false;
        } catch {
          return false;
        }
      },
    },
  ],
  toDOM: (node) => [
    "span",
    {
      "data-comment-thread": node.attrs.threadId,
      "data-comment-edge": node.attrs.edge,
      "data-comment-content": JSON.stringify(node.attrs.thread),
      class:
        "document-comment-anchor" +
        (node.attrs.thread?.resolved ? " resolved" : ""),
      title: node.attrs.thread?.entries[0]?.text || "Comment",
      contenteditable: "false",
      "aria-label": "Comment",
    },
  ],
};
type Anchor = { node: PMNode; pos: number; hidden?: boolean };
// Unchanged paragraphs reuse their index; a keystroke does not rescan the book.
const anchorCache = new WeakMap<PMNode, Anchor[]>();
function anchors(node: PMNode): Anchor[] {
  let found = anchorCache.get(node);
  if (found) return found;
  found = [];
  node.forEach((child, offset) => {
    if (child.type.name === "comment_anchor")
      found!.push({ node: child, pos: offset });
    else if (!child.isLeaf)
      for (const anchor of anchors(child))
        found!.push({ node: anchor.node, pos: offset + 1 + anchor.pos,
          hidden: anchor.hidden || child.attrs.revisionMove?.kind === 'deletion' });
  });
  anchorCache.set(node, found);
  return found;
}
export type DocumentComment = {
  id: string;
  thread: CommentThread;
  anchors: Anchor[];
  from: number;
  to: number;
  incomplete: boolean;
  context: string;
};
const commentCache = new WeakMap<PMNode, DocumentComment[]>();
export function documentComments(doc: PMNode): DocumentComment[] {
  const cached = commentCache.get(doc);
  if (cached) return cached;
  const grouped = new Map<string, Anchor[]>();
  for (const anchor of anchors(doc))
    grouped.set(anchor.node.attrs.threadId, [
      ...(grouped.get(anchor.node.attrs.threadId) || []),
      anchor,
    ]);
  const result = [...grouped].map(([id, items]) => {
    const visible = items.filter(a => !a.hidden);
    const starts = visible.filter((a) => a.node.attrs.edge === "start"),
      ends = visible.filter((a) => a.node.attrs.edge === "end");
    const incomplete =
      starts.length !== 1 || ends.length !== 1 || starts[0].pos >= ends[0].pos;
    const from = (starts[0] || ends[0] || items[0]).pos + 1,
      to = incomplete ? from : ends[0].pos;
    return {
      id,
      thread: (starts[0] || ends[0] || items[0]).node.attrs.thread as CommentThread,
      anchors: items,
      from,
      to,
      incomplete,
      context: doc
        .textBetween(from, Math.min(to, from + 240), " ")
        .slice(0, 120),
    };
  });
  commentCache.set(doc, result);
  return result;
}
export const commentEntry = (author: string, text: string): CommentEntry => ({
  id: `entry_${crypto.randomUUID()}`,
  author: author.trim(),
  text: text.trim(),
  date: new Date().toISOString(),
});
export function addDocumentComment(
  thread: CommentThread,
  existingId?: string,
): Command {
  return (state, dispatch) => {
    const { from, to, $from, $to } = state.selection,
      type = state.schema.nodes.comment_anchor;
    if (
      !validCommentThread(thread) ||
      !$from.parent.inlineContent ||
      !$to.parent.inlineContent ||
      !$from.parent.canReplaceWith($from.index(), $from.index(), type) ||
      !$to.parent.canReplaceWith($to.index(), $to.index(), type)
    )
      return false;
    // Mirror annotations into both sides of a pending move. The text is
    // immutable until reviewed, so relative positions map without ambiguity.
    const pending = (position: number) => {
      const at = state.doc.resolve(position);
      for (let depth = at.depth; depth > 0; depth--)
        if (at.node(depth).attrs.revisionMove || at.node(depth).attrs.revisionBlock)
          return { node: at.node(depth), pos: at.before(depth) };
      return null;
    };
    const left = pending(from), right = pending(to);
    const ranges = [{ from, to }];
    if (left || right) {
      const a = left?.node.attrs.revisionMove, b = right?.node.attrs.revisionMove;
      const rowA = left && ['table','table_row'].includes(left.node.type.name) && left.node.attrs.revisionBlock;
      const rowB = right && ['table','table_row'].includes(right.node.type.name) && right.node.attrs.revisionBlock;
      const rowRange = rowA && rowB && rowA.stamp.id === rowB.stamp.id && rowA.kind === rowB.kind;
      if (!rowRange && (!a || !b || a.stamp.id !== b.stamp.id || a.kind !== b.kind)) return false;
      if (!rowRange) {
        const counterpart = (source: NonNullable<typeof left>, position: number) => {
          let result: number | undefined;
          const move = source.node.attrs.revisionMove;
          state.doc.descendants((node, pos) => {
            const other = node.attrs.revisionMove;
            if (other?.stamp.id === move.stamp.id && other.kind !== move.kind && (other.part ?? 0) === (move.part ?? 0))
              result = pos + position - source.pos;
          });
          return result;
        };
        const start = counterpart(left!, from), end = counterpart(right!, to);
        if (start === undefined || end === undefined || start > end) return false;
        ranges.push({ from: start, to: end });
      }
    }
    if (dispatch) {
      const tr = closeHistory(state.tr).setMeta("reviewAnnotation", true),
        threadId = existingId || `comment_${crypto.randomUUID()}`;
      if (existingId)
        for (const anchor of (
          documentComments(state.doc).find((c) => c.id === existingId)
            ?.anchors || []
        )
          .slice()
          .reverse())
          tr.delete(anchor.pos, anchor.pos + 1);
      const edges = ranges.flatMap(range => [
        { pos: range.to, edge: 'end' }, { pos: range.from, edge: 'start' },
      ]).sort((a, b) => b.pos - a.pos);
      for (const { pos, edge } of edges)
        tr.insert(tr.mapping.map(pos, -1), type.create({ threadId, thread, edge, blockId: `block_${crypto.randomUUID()}` }));
      const added = documentComments(tr.doc).find(c => c.id === threadId)!;
      tr.setSelection(TextSelection.create(tr.doc, added.from, added.to));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}
export function changeDocumentComment(
  id: string,
  thread: CommentThread | null,
): Command {
  return (state, dispatch) => {
    const item = documentComments(state.doc).find((c) => c.id === id);
    if (!item || (thread && !validCommentThread(thread))) return false;
    if (dispatch) {
      const tr = closeHistory(state.tr).setMeta("reviewAnnotation", true);
      for (const { node, pos } of item.anchors.slice().reverse()) {
        if (thread) tr.setNodeMarkup(pos, undefined, { ...node.attrs, thread });
        else tr.delete(pos, pos + 1);
      }
      dispatch(tr);
    }
    return true;
  };
}
export function goToDocumentComment(id: string): Command {
  return (state, dispatch) => {
    const item = documentComments(state.doc).find((c) => c.id === id);
    if (!item) return false;
    dispatch?.(
      state.tr
        .setSelection(TextSelection.create(state.doc, item.from, item.to))
        .scrollIntoView(),
    );
    return true;
  };
}
export function commentDecorations() {
  const build = (doc: PMNode) =>
    DecorationSet.create(
      doc,
      documentComments(doc).flatMap((item) =>
        !item.incomplete && !item.thread.resolved && item.to > item.from
          ? [
              Decoration.inline(item.from, item.to, {
                class: "document-comment-passage",
              }),
            ]
          : [],
      ),
    );
  return new Plugin<DecorationSet>({
    state: {
      init: (_, state) => build(state.doc),
      apply: (tr, value) => (tr.docChanged ? build(tr.doc) : value),
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}
