import { Fragment, Slice, type Node as PMNode } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";
import { ReplaceStep } from "prosemirror-transform";
import { markedDeletion, type RevisionStamp } from "./trackedChanges";

/** A replacement spanning prose paragraphs retains deleted paragraph marks in
 * the first resulting paragraph. New paragraph marks pair with fresh following
 * identities. Original view can therefore rebuild both wording and formatting. */
export function trackRangeTransaction(
  state: EditorState,
  tr: Transaction,
  stamp: RevisionStamp,
): Transaction | null {
  if (tr.steps.length !== 1 || !(tr.steps[0] instanceof ReplaceStep))
    return null;
  const step = tr.steps[0],
    from = state.doc.resolve(step.from),
    to = state.doc.resolve(step.to);
  if (from.sameParent(to) && !step.slice.openStart && !step.slice.openEnd)
    return null;
  const prose = (node: PMNode) =>
    ["paragraph", "heading"].includes(node.type.name);
  if (
    !prose(from.parent) ||
    !prose(to.parent) ||
    from.depth !== to.depth ||
    from.node(-1) !== to.node(-1)
  )
    return null;
  if (step.slice.openStart !== step.slice.openEnd || step.slice.openStart > 1)
    return null;
  const container = from.node(-1),
    first = from.index(-1),
    last = to.index(-1);
  const source: PMNode[] = [];
  for (let i = first; i <= last; i++) {
    const paragraph = container.child(i);
    if (!prose(paragraph)) return null;
    let unsupported = false;
    paragraph.forEach((node) => {
      if (!node.isText && node.type.name !== "hard_break") unsupported = true;
    });
    if (unsupported)
      throw new Error(
        "This paragraph replacement crosses an object or a pending paragraph boundary. Review that boundary first; the document has not changed.",
      );
    source.push(paragraph);
  }
  let invalid = false;
  step.slice.content.descendants((node) => {
    if (!prose(node) && !node.isText && node.type.name !== "hard_break")
      invalid = true;
    if (
      tr.getMeta("uiEvent") === "paste" &&
      (node.attrs.revisionProperties ||
        node.marks.some((mark) => mark.type.name.startsWith("revision_")))
    )
      invalid = true;
  });
  if (invalid)
    throw new Error(
      "This tracked replacement needs plain paragraphs without embedded objects or pending revisions. The document has not changed.",
    );
  const selection = tr.selection,
    count = tr.steps.length;
  const ranges: { from: number; to: number }[] = [],
    boundaries: { pos: number; node: PMNode }[] = [];
  const end = step.from + step.slice.size;
  tr.doc.nodesBetween(step.from, end, (node, pos) => {
    if (prose(node) && pos >= step.from && pos < end)
      boundaries.push({ pos, node });
    if (node.isText || node.type.name === "hard_break")
      ranges.push({
        from: Math.max(step.from, pos),
        to: Math.min(end, pos + node.nodeSize),
      });
  });
  for (const range of ranges) {
    if (range.from >= range.to) continue;
    for (const name of [
      "revision_insertion",
      "revision_deletion",
      "revision_format",
    ])
      tr.removeMark(range.from, range.to, state.schema.marks[name]);
    tr.addMark(
      range.from,
      range.to,
      state.schema.marks.revision_insertion.create(stamp),
    );
  }
  for (const { pos, node } of boundaries.reverse()) {
    const nextId = `block_${crypto.randomUUID()}`;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: nextId });
    tr.insert(
      pos - 1,
      state.schema.nodes.revision_break.create({
        kind: "insertion",
        stamp,
        nextId,
        blockId: `block_${crypto.randomUUID()}`,
      }),
    );
  }
  const retained: PMNode[] = [];
  source.forEach((paragraph, index) => {
    const start = index === 0 ? from.parentOffset : 0,
      end =
        index === source.length - 1 ? to.parentOffset : paragraph.content.size;
    const removed = markedDeletion(
      new Slice(paragraph.content.cut(start, end), 0, 0),
      state.schema,
      stamp,
    );
    removed.content.forEach((node) => retained.push(node));
    if (index < source.length - 1)
      retained.push(
        state.schema.nodes.revision_break.create({
          kind: "deletion",
          stamp,
          rightType: source[index + 1].type.name,
          rightAttrs: source[index + 1].attrs,
          blockId: `block_${crypto.randomUUID()}`,
        }),
      );
  });
  if (retained.length)
    tr.insert(
      tr.mapping.slice(count).map(step.from, -1),
      Fragment.fromArray(retained),
    );
  tr.setSelection(selection.map(tr.doc, tr.mapping.slice(count)));
  tr.setStoredMarks(
    (tr.storedMarks || []).filter(
      (mark) => !mark.type.name.startsWith("revision_"),
    ),
  );
  return tr.setMeta("trackedEdit", stamp.id);
}
