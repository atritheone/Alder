import {
  Fragment,
  Slice,
  type MarkSpec,
  type Node as PMNode,
  type Schema,
} from "prosemirror-model";
import { type EditorState, type Transaction } from "prosemirror-state";
import { closeHistory, isHistoryTransaction } from "prosemirror-history";
import { ReplaceStep } from "prosemirror-transform";

export type RevisionKind = "insertion" | "deletion";
export type RevisionStamp = { id: string; author: string; date: string };
export type ReviewView = "final" | "original" | "markup";
export const revisionMark = (kind: RevisionKind) => `revision_${kind}`;
export const isRevisionMark = (name: string) =>
  name === "revision_insertion" || name === "revision_deletion";
export function validRevisionStamp(value: unknown): value is RevisionStamp {
  const stamp = value as RevisionStamp;
  return (
    !!stamp &&
    typeof stamp.id === "string" &&
    /^[A-Za-z0-9_.-]{1,128}$/.test(stamp.id) &&
    typeof stamp.author === "string" &&
    stamp.author.length <= 200 &&
    typeof stamp.date === "string" &&
    stamp.date.length <= 40 &&
    (stamp.date === "" || Number.isFinite(Date.parse(stamp.date)))
  );
}
export function revisionMarkSpec(kind: RevisionKind): MarkSpec {
  return {
    attrs: { id: {}, author: { default: "" }, date: { default: "" } },
    inclusive: false,
    excludes: "",
    spanning: true,
    parseDOM: [
      {
        tag: `span[data-revision-${kind}]`,
        priority: 80,
        getAttrs(dom) {
          const attrs = {
            id: dom.getAttribute(`data-revision-${kind}`),
            author: dom.getAttribute("data-revision-author") || "",
            date: dom.getAttribute("data-revision-date") || "",
          };
          return validRevisionStamp(attrs) ? attrs : false;
        },
      },
    ],
    toDOM: (mark) => [
      "span",
      {
        [`data-revision-${kind}`]: mark.attrs.id,
        "data-revision-author": mark.attrs.author,
        "data-revision-date": mark.attrs.date,
        class: `document-revision-${kind}`,
      },
      0,
    ],
  };
}
export function reviewDocument(doc: PMNode, view: ReviewView): PMNode {
  if (view === "markup") return doc;
  const walk = (node: PMNode): PMNode | null => {
    if (
      node.marks.some(
        (mark) =>
          mark.type.name ===
          revisionMark(view === "final" ? "deletion" : "insertion"),
      )
    )
      return null;
    const marks = node.marks.filter((mark) => !isRevisionMark(mark.type.name));
    if (node.isLeaf)
      return marks.length === node.marks.length ? node : node.mark(marks);
    const children: PMNode[] = [];
    node.forEach((child) => {
      const next = walk(child);
      if (next) children.push(next);
    });
    return node.copy(Fragment.fromArray(children)).mark(marks);
  };
  return walk(doc)!;
}
export type DocumentChange = RevisionStamp & {
  ranges: { from: number; to: number; kind: RevisionKind; text: string }[];
};
const changesCache = new WeakMap<PMNode, DocumentChange[]>();
export function documentChanges(doc: PMNode): DocumentChange[] {
  const cached = changesCache.get(doc);
  if (cached) return cached;
  const groups = new Map<string, DocumentChange>();
  doc.descendants((node, pos) => {
    for (const mark of node.marks) {
      if (!isRevisionMark(mark.type.name)) continue;
      const stamp = mark.attrs as RevisionStamp;
      const group = groups.get(stamp.id) || { ...stamp, ranges: [] };
      group.ranges.push({
        from: pos,
        to: pos + node.nodeSize,
        kind:
          mark.type.name === "revision_insertion" ? "insertion" : "deletion",
        text: node.textContent,
      });
      groups.set(stamp.id, group);
    }
  });
  const result = [...groups.values()];
  changesCache.set(doc, result);
  return result;
}
export function resolveChanges(
  state: EditorState,
  ids: ReadonlySet<string>,
  decision: "accept" | "reject",
) {
  const tr = closeHistory(state.tr).setMeta("reviewDecision", true);
  const affected: { node: PMNode; pos: number }[] = [];
  state.doc.descendants((node, pos) => {
    if (
      node.isInline &&
      node.marks.some(
        (mark) => isRevisionMark(mark.type.name) && ids.has(mark.attrs.id),
      )
    ) {
      affected.push({ node, pos });
      return false;
    }
  });
  for (const { node, pos } of affected.reverse()) {
    const selected = node.marks.filter(
      (mark) => isRevisionMark(mark.type.name) && ids.has(mark.attrs.id),
    );
    const remove = selected.some(
      (mark) =>
        mark.type.name ===
        revisionMark(decision === "accept" ? "deletion" : "insertion"),
    );
    if (remove) tr.delete(pos, pos + node.nodeSize);
    else
      for (const mark of selected)
        tr.removeMark(pos, pos + node.nodeSize, mark);
  }
  return tr.scrollIntoView();
}
export function markedDeletion(
  slice: Slice,
  schema: Schema,
  stamp: RevisionStamp,
) {
  const children: PMNode[] = [];
  slice.content.forEach((node) => {
    // Removing one's own pending insertion cancels that insertion. Another
    // author's insertion remains a separate, independently reviewable change.
    if (
      node.marks.some(
        (mark) =>
          mark.type.name === "revision_insertion" &&
          mark.attrs.author === stamp.author,
      ) &&
      !node.marks.some((mark) => mark.type.name === "revision_deletion")
    )
      return;
    const marks = node.marks.some(
      (mark) => mark.type.name === "revision_deletion",
    )
      ? node.marks
      : schema.marks.revision_deletion.create(stamp).addToSet(node.marks);
    children.push(node.mark(marks));
  });
  return new Slice(Fragment.fromArray(children), 0, 0);
}
/** Record an inline replacement in the same transaction/history event. The
 * bounded implementation refuses structural steps rather than losing them.
 * This engine is qualified independently before its editor integration. */
export function trackInlineTransaction(
  state: EditorState,
  transaction: Transaction,
  stamp: RevisionStamp,
): Transaction {
  if (
    !transaction.docChanged ||
    transaction.getMeta("reviewDecision") ||
    transaction.getMeta("addToHistory") === false ||
    isHistoryTransaction(transaction)
  )
    return transaction;
  if (!validRevisionStamp(stamp))
    throw new Error("Set a valid review author before tracking changes.");
  const count = transaction.steps.length;
  for (let i = 0; i < count; i++) {
    const step = transaction.steps[i],
      before = transaction.docs[i];
    if (
      !(step instanceof ReplaceStep) ||
      step.slice.openStart ||
      step.slice.openEnd ||
      !before.resolve(step.from).sameParent(before.resolve(step.to)) ||
      !before.resolve(step.from).parent.inlineContent
    )
      throw new Error(
        "This structural edit needs tracked structure support. The document has not changed.",
      );
    const nodes: PMNode[] = [];
    step.slice.content.forEach((node) => nodes.push(node));
    if (
      transaction.getMeta("uiEvent") === "paste" &&
      nodes.some((node) =>
        node.marks.some((mark) => mark.type.name.startsWith("revision_")),
      )
    )
      throw new Error(
        "This copied text contains pending changes. Review the copied changes first, or use Paste plain text to insert the displayed wording as a new change.",
      );
    before.nodesBetween(step.from, step.to, (node) => {
      if (node.isInline) nodes.push(node);
    });
    if (nodes.some((node) => !node.isText && node.type.name !== "hard_break"))
      throw new Error(
        "This edit contains an inline object. The document has not changed.",
      );
  }
  const selection = transaction.selection;
  const originalSteps = transaction.steps.slice(),
    originalDocs = transaction.docs.slice();
  // Each original replacement is located in the final document, then mapped
  // through the additional annotation steps. Reverse order preserves ranges.
  for (let i = count - 1; i >= 0; i--) {
    const step = originalSteps[i] as ReplaceStep;
    const after = transaction.mapping.slice(i + 1, count);
    const start = after.map(step.from, 1),
      end = after.map(step.from + step.slice.size, -1);
    const extra = transaction.mapping.slice(count);
    const from = extra.map(start, 1),
      to = extra.map(Math.max(start, end), -1);
    if (to > from) {
      // Newly typed wording inherits appearance, never the preceding run's
      // insertion/deletion identity or formatting review history.
      for (const name of [
        "revision_insertion",
        "revision_deletion",
        "revision_format",
      ])
        if (state.schema.marks[name])
          transaction.removeMark(from, to, state.schema.marks[name]);
      transaction.addMark(
        from,
        to,
        state.schema.marks.revision_insertion.create(stamp),
      );
    }
    const deleted = markedDeletion(
      originalDocs[i].slice(step.from, step.to),
      state.schema,
      stamp,
    );
    if (deleted.size) transaction.replace(from, from, deleted);
  }
  transaction.setSelection(
    selection.map(transaction.doc, transaction.mapping.slice(count)),
  );
  transaction.setStoredMarks(
    (transaction.storedMarks || []).filter(
      (mark) => !mark.type.name.startsWith("revision_"),
    ),
  );
  return transaction.setMeta("trackedEdit", stamp.id);
}
