import { Fragment, type Node as PMNode } from "prosemirror-model";
import {
  TextSelection,
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
        ...(ordered ? { order } : {}),
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
          ...(ordered ? { order } : {}),
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
