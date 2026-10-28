import { Fragment, type Node as PMNode } from "prosemirror-model";
import { Plugin } from "prosemirror-state";

/** Identity belongs to a block, never its current position or page. */
export function identifiedDocument(doc: PMNode): PMNode {
  const seen = new Set<string>();
  const walk = (node: PMNode): PMNode => {
    let result = node;
    if (Object.hasOwn(node.attrs, "blockId")) {
      const id = node.attrs.blockId;
      if (!id || seen.has(id))
        result = node.type.create(
          { ...node.attrs, blockId: `block_${crypto.randomUUID()}` },
          node.content,
          node.marks,
        );
      seen.add(result.attrs.blockId);
    }
    const children: PMNode[] = [];
    let changed = false;
    node.forEach((child) => {
      const next = walk(child);
      children.push(next);
      changed ||= next !== child;
    });
    return changed ? result.copy(Fragment.fromArray(children)) : result;
  };
  return walk(doc);
}

export function blockIdentities() {
  return new Plugin({
    appendTransaction(transactions, _previous, state) {
      // Text-only edits cannot add or duplicate structural identities.
      if (
        !transactions.some(
          (tr) =>
            tr.docChanged &&
            tr.steps.some((step) => {
              const slice = (
                step as unknown as { slice?: { content: Fragment } }
              ).slice;
              let structural = false;
              slice?.content.descendants((node) => {
                if (node.isBlock) structural = true;
              });
              return structural;
            }),
        )
      )
        return null;
      const fixed = identifiedDocument(state.doc);
      if (fixed === state.doc) return null;
      const tr = state.tr;
      fixed.descendants((node, position) => {
        if (
          Object.hasOwn(node.attrs, "blockId") &&
          node.attrs.blockId !== state.doc.nodeAt(position)?.attrs.blockId
        )
          tr.setNodeMarkup(position, undefined, node.attrs);
      });
      return tr;
    },
  });
}
