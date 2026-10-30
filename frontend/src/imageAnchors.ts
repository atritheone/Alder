import type { Node as PMNode } from "prosemirror-model";
import { Plugin, NodeSelection, type Transaction } from "prosemirror-state";

const wrapped = (node: PMNode) =>
  ["inline_image","text_box"].includes(node.type.name) &&
  ["left", "right"].includes(node.attrs.wrap);

/** Paragraph anchors follow the paragraph (or the sentence carrying the atom),
 * including paste and Arrangement. Moving only the atom preserves text marks,
 * comment ranges and the edit's normal history group. */
export function anchorPictures(
  tr: Transaction,
  checked?: WeakSet<PMNode>,
): Transaction {
  const paragraphs: { node: PMNode; pos: number }[] = [];
  tr.doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (!checked?.has(node)) paragraphs.push({ node, pos });
      return false;
    }
  });
  const selected =
    tr.selection instanceof NodeSelection && wrapped(tr.selection.node)
      ? tr.selection.node.attrs.blockId
      : null;
  for (const { node, pos } of paragraphs.reverse()) {
    let prefix = 0,
      step = 0;
    node.forEach((child, offset) => {
      if (!wrapped(child)) return;
      if (offset !== prefix) {
        const at = pos + 1 + offset;
        // Earlier pictures only move within the same paragraph, so original
        // offsets of subsequent pictures are unchanged.
        tr.delete(at, at + child.nodeSize).insert(pos + 1 + prefix, child);
        step++;
      }
      prefix += child.nodeSize;
    });
    if (step && selected) {
      tr.doc.nodeAt(pos)!.forEach((child, offset) => {
        if (child.attrs.blockId === selected)
          tr.setSelection(NodeSelection.create(tr.doc, pos + 1 + offset));
      });
    }
    checked?.add(tr.doc.nodeAt(pos)!);
  }
  return tr;
}

export function imageAnchors() {
  const checked = new WeakSet<PMNode>();
  return new Plugin({
    appendTransaction(transactions, _old, state) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const tr = anchorPictures(state.tr, checked);
      return tr.docChanged ? tr : null;
    },
  });
}
