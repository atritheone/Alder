import type { Fragment, Node as PMNode } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import { ReplaceStep } from "prosemirror-transform";

function objects(
  fragment: Fragment,
  output: Set<string>,
  captions?: Set<string>,
) {
  fragment.descendants((node) => {
    if (
      ["image", "inline_image", "table"].includes(node.type.name) &&
      node.attrs.blockId
    )
      output.add(node.attrs.blockId);
    if (node.attrs.captionTargetId) captions?.add(node.attrs.blockId);
  });
}

function objectLocation(doc: PMNode, id: string) {
  let found: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (
      node.attrs.blockId !== id ||
      !["image", "inline_image", "table"].includes(node.type.name)
    )
      return;
    const point = doc.resolve(pos);
    found = node.isInline
      ? { from: point.before(), to: point.after() }
      : { from: pos, to: pos + node.nodeSize };
    return false;
  });
  return found as { from: number; to: number } | null;
}

/** Follow an actual object move, not positional shifts caused by ordinary typing.
 * Captions deliberately moved/edited with a larger selection keep that placement.
 * Inspect changed slices first; text-only transactions never scan the document.
 */
export function captionAnchors() {
  return new Plugin({
    appendTransaction(transactions, previous, state) {
      const moved = new Set<string>(),
        movedCaptions = new Set<string>();
      for (const transaction of transactions) {
        if (!transaction.docChanged || transaction.getMeta("captionFollow"))
          continue;
        const removed = new Set<string>(),
          inserted = new Set<string>();
        transaction.steps.forEach((step, index) => {
          if (!(step instanceof ReplaceStep)) return;
          if (step.to > step.from)
            objects(
              transaction.docs[index].slice(step.from, step.to).content,
              removed,
              movedCaptions,
            );
          objects(step.slice.content, inserted);
        });
        for (const id of removed) if (inserted.has(id)) moved.add(id);
      }
      if (!moved.size) return null;
      const tr = state.tr.setMeta("captionFollow", true);
      for (const id of moved) {
        const old = objectLocation(previous.doc, id);
        if (!old) continue;
        const before = previous.doc.resolve(old.from).nodeBefore;
        const after = previous.doc.resolve(old.to).nodeAfter;
        const above = before?.attrs.captionTargetId === id;
        const caption = above
          ? before
          : after?.attrs.captionTargetId === id
            ? after
            : null;
        if (!caption || movedCaptions.has(caption.attrs.blockId)) continue;
        const destination = objectLocation(tr.doc, id);
        if (!destination) continue;
        const at = above ? destination.from : destination.to;
        const point = tr.doc.resolve(at);
        const neighbor = above ? point.nodeBefore : point.nodeAfter;
        if (neighbor?.attrs.blockId === caption.attrs.blockId) continue;
        let position = -1,
          current: PMNode | null = null;
        tr.doc.descendants((node, pos) => {
          if (node.attrs.blockId === caption.attrs.blockId) {
            position = pos;
            current = node;
            return false;
          }
        });
        if (
          !current ||
          position < 0 ||
          !point.parent.canReplaceWith(
            point.index(),
            point.index(),
            caption.type,
          )
        )
          continue;
        const content = current as PMNode;
        tr.delete(position, position + content.nodeSize);
        const insertion = position < at ? at - content.nodeSize : at;
        tr.insert(insertion, content);
      }
      return tr.docChanged ? tr : null;
    },
  });
}
