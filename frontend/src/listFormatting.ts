import { Fragment, type Node as PMNode } from "prosemirror-model";
import {
  TextSelection,
  Plugin,
  type Command,
  type EditorState,
} from "prosemirror-state";
import { closeHistory } from "prosemirror-history";

export const numberedMarkers = [
  "decimal",
  "lower-alpha",
  "upper-alpha",
  "lower-roman",
  "upper-roman",
] as const;
export const bulletMarkers = ["disc", "circle", "square"] as const;
export function selectedList(state: EditorState) {
  const { $from, $to } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (
      ["ordered_list", "bullet_list"].includes(node.type.name) &&
      $to.pos <= $from.after(depth)
    )
      return {
        node,
        depth,
        position: $from.before(depth),
        index: $from.index(depth),
      };
  }
  return null;
}
export function setListFormatting(
  listStyle: string,
  order: number,
  fromItem = false,
  continuePrevious = false,
): Command {
  return (state, dispatch) => {
    const selected = selectedList(state);
    if (!selected) return false;
    const { node, position, index } = selected;
    const ordered = node.type.name === "ordered_list";
    if (
      !(ordered ? [...numberedMarkers] : [...bulletMarkers]).includes(
        listStyle as never,
      ) ||
      !Number.isInteger(order) ||
      order < 1 ||
      order > 100000
    )
      return false;
    if (!dispatch) return true;
    const tr = closeHistory(state.tr);
    if (!fromItem || index === 0) {
      tr.setNodeMarkup(position, undefined, {
        ...node.attrs,
        listStyle,
        ...(ordered ? { order, continuePrevious } : {}),
      });
    } else {
      const before: PMNode[] = [],
        after: PMNode[] = [];
      for (let i = 0; i < node.childCount; i++)
        (i < index ? before : after).push(node.child(i));
      const first = node.copy(Fragment.fromArray(before));
      const second = node.type.create(
        {
          ...node.attrs,
          blockId: null,
          listStyle,
          ...(ordered ? { order, continuePrevious } : {}),
        },
        after,
      );
      tr.replaceWith(position, position + node.nodeSize, [first, second]);
      // Splitting the list adds two container boundaries before the held item.
      tr.setSelection(
        TextSelection.create(
          tr.doc,
          state.selection.from + 2,
          state.selection.to + 2,
        ),
      );
    }
    dispatch(tr);
    return true;
  };
}

/** Continuations follow the preceding list with the same marker in the same
 * container. Nested lists and table cells have independent sequences. */
export function listOrders(doc: PMNode) {
  const updates: { position: number; order: number }[] = [];
  function walk(parent: PMNode, start: number) {
    const preceding = new Map<string, number>();
    parent.forEach((node, offset) => {
      const position = start + offset;
      if (node.type.name === "ordered_list") {
        const marker = node.attrs.listTemplate?JSON.stringify(node.attrs.listTemplate):(node.attrs.listStyle || "decimal");
        const order = node.attrs.continuePrevious
          ? (preceding.get(marker) ?? 1)
          : node.attrs.order;
        if (order !== node.attrs.order) updates.push({ position, order });
        preceding.set(marker, order + node.childCount);
      }
      if (node.childCount && !node.isTextblock) walk(node, position + 1);
    });
  }
  walk(doc, 0);
  return updates;
}
export function continuedLists() {
  return new Plugin({
    appendTransaction(transactions, _old, state) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const updates = listOrders(state.doc);
      if (!updates.length) return null;
      const tr = state.tr;
      for (const { position, order } of updates)
        tr.setNodeMarkup(position, undefined, {
          ...state.doc.nodeAt(position)!.attrs,
          order,
        });
      return tr;
    },
  });
}
export function normaliseListOrders(doc: PMNode): PMNode {
  const orders = new Map(
    listOrders(doc).map(({ position, order }) => [position, order]),
  );
  if (!orders.size) return doc;
  function walk(node: PMNode, position: number): PMNode {
    if (node.isLeaf) return node;
    const children: PMNode[] = [];
    node.forEach((child, offset) =>
      children.push(walk(child, position + 1 + offset)),
    );
    const attrs = orders.has(position)
      ? { ...node.attrs, order: orders.get(position) }
      : node.attrs;
    return node.type.create(attrs, children, node.marks);
  }
  return walk(doc, -1);
}
