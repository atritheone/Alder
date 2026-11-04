import { Fragment, type Node as PMNode } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";
import { ReplaceStep } from "prosemirror-transform";
import {
  trackInlineTransaction,
  type RevisionStamp,
  isRevisionMark,
} from "./trackedChanges";
import {
  trackBlockMove,
  validateBlockMoves,
  blockMoveChanges,
} from "./trackedBlockMoves";

/** A move is one review decision with two contiguous, author-attributed sides.
 * Keeping the ordinary insertion/deletion projection also keeps speech and
 * proofreading on the final wording without a second text representation. */
export function validateReviewMoves(doc: PMNode | Fragment) {
  validateBlockMoves(doc);
  const blockIds = new Set(blockMoveChanges(doc).map((x) => x.move.stamp.id));
  const groups = new Map<
    string,
    {
      author: string;
      date: string;
      sides: Map<
        string,
        {
          from: number;
          to: number;
          parent: PMNode | null;
          text: string;
          nodes: PMNode[];
        }
      >;
    }
  >();
  doc.descendants((node, pos, parent) => {
    const marks = node.marks.filter(
      (mark) => isRevisionMark(mark.type.name) && mark.attrs.move,
    );
    for (const mark of marks) {
      if (blockIds.has(mark.attrs.id))
        throw Error("Inline and paragraph moves need separate identities.");
      if (
        marks.length !== 1 ||
        node.marks.some(
          (m) => m !== mark && m.type.name.startsWith("revision_"),
        ) ||
        (!node.isText && node.type.name !== "hard_break")
      )
        throw new Error(
          "Tracked moves currently require text without overlapping revisions or objects.",
        );
      const { id, author, date } = mark.attrs,
        group = groups.get(id) || { author, date, sides: new Map() };
      if (group.author !== author || group.date !== date)
        throw new Error(
          "The two sides of a tracked move must have the same author and date.",
        );
      const previous = group.sides.get(mark.type.name);
      if (previous && (previous.to !== pos || previous.parent !== parent))
        throw new Error(
          "A tracked move must retain one complete source and destination.",
        );
      const nodes = previous?.nodes || [];
      nodes.push(
        node.mark(node.marks.filter((m) => !isRevisionMark(m.type.name))),
      );
      group.sides.set(mark.type.name, {
        from: previous?.from ?? pos,
        to: pos + node.nodeSize,
        parent,
        text: (previous?.text ?? "") + (node.text ?? "\n"),
        nodes,
      });
      groups.set(id, group);
    }
  });
  for (const group of groups.values()) {
    if (group.sides.size !== 2)
      throw new Error(
        "Copy both sides of a tracked move, or accept or reject it first.",
      );
    const [from, to] = [...group.sides.values()].map((side) =>
      side.text.trim(),
    );
    if (!from || from !== to)
      throw new Error(
        "A tracked move must retain the same wording at its source and destination.",
      );
    const [a, b] = [...group.sides.values()].map((side) =>
      Fragment.fromArray(side.nodes).cut(
        side.text.length - side.text.trimStart().length,
        side.text.trimEnd().length,
      ),
    );
    if (!a.eq(b))
      throw Error(
        "A tracked move must retain the same character formatting at both ends.",
      );
  }
}

export function protectPendingMoves(state: EditorState, source: Transaction) {
  for (let i = 0; i < source.steps.length; i++) {
    const step = source.steps[i] as {
        from?: number;
        to?: number;
        pos?: number;
      },
      before = source.docs[i];
    if (step.pos != null) {
      const at = before.resolve(step.pos);
      let pending = !!(
        before.nodeAt(step.pos)?.attrs.revisionMove ||
        before.nodeAt(step.pos)?.attrs.revisionBlock
      );
      for (let depth = at.depth; depth > 0; depth--)
        pending ||= !!(
          at.node(depth).attrs.revisionMove ||
          at.node(depth).attrs.revisionBlock
        );
      if (pending)
        throw new Error(
          "Accept or reject this tracked move before changing its properties.",
        );
    }
    if (step.from == null || step.to == null) continue;
    let intersects = false;
    const at = before.resolve(step.from);
    for (let depth = at.depth; depth > 0; depth--)
      if (
        at.node(depth).attrs.revisionMove ||
        at.node(depth).attrs.revisionBlock
      )
        intersects = true;
    if (step.from === step.to) {
      const at = before.resolve(step.from);
      const leftBlock =
          at.nodeBefore?.attrs.revisionMove ||
          at.nodeBefore?.attrs.revisionBlock,
        rightBlock =
          at.nodeAfter?.attrs.revisionMove || at.nodeAfter?.attrs.revisionBlock;
      if (
        leftBlock &&
        rightBlock &&
        leftBlock.kind === rightBlock.kind &&
        leftBlock.stamp.id === rightBlock.stamp.id
      )
        intersects = true;
      const left = at.nodeBefore?.marks.find(
        (m) => m.attrs.move && isRevisionMark(m.type.name),
      );
      intersects ||= !!left && !!at.nodeAfter?.marks.some((m) => m.eq(left));
    } else
      before.nodesBetween(step.from, step.to, (node) => {
        if (
          node.attrs.revisionMove ||
          node.attrs.revisionBlock ||
          node.marks.some((m) => m.attrs.move && isRevisionMark(m.type.name))
        )
          intersects = true;
      });
    if (intersects)
      throw new Error(
        "Accept or reject this tracked move before changing its contents or moving it again.",
      );
  }
}

export function trackArrangementMove(
  state: EditorState,
  source: Transaction,
  stamp: RevisionStamp,
) {
  const move = source.getMeta("arrangementMove");
  if (!move) return null;
  const block = trackBlockMove(state, source, stamp);
  if (block) return block;
  if (
    move.kind !== "sentence" ||
    source.steps.length !== 2 ||
    source.steps.some(
      (step) =>
        !(step instanceof ReplaceStep) ||
        step.slice.openStart ||
        step.slice.openEnd,
    ) ||
    !state.doc.resolve(move.from).sameParent(state.doc.resolve(move.to))
  )
    throw new Error(
      "Tracked paragraph and cross-paragraph moves are not available yet. The document has not changed.",
    );
  for (let i = 0; i < source.steps.length; i++) {
    const step = source.steps[i] as ReplaceStep;
    source.docs[i].nodesBetween(step.from, step.to, (node) => {
      if (node.marks.some((mark) => mark.type.name.startsWith("revision_")))
        throw new Error(
          "Review the sentence's existing changes before moving it.",
        );
    });
  }
  const tracked = trackInlineTransaction(state, source, {
    ...stamp,
    move: true,
  });
  validateReviewMoves(tracked.doc);
  return tracked;
}
