import {
  NodeSelection,
  type Command,
  type EditorState,
} from "prosemirror-state";
import { closeHistory } from "prosemirror-history";

export function selectedImage(state: EditorState) {
  const selection = state.selection;
  return selection instanceof NodeSelection &&
    selection.node.type.name === "image"
    ? { node: selection.node, pos: selection.from }
    : null;
}

export function setImageProperties(
  blockId: string,
  values: {
    width: number | null;
    align: string;
    alt: string;
    title: string | null;
    assetId?: string;
    src?: string;
  },
): Command {
  return (state, dispatch) => {
    if (
      values.width != null &&
      (!Number.isFinite(values.width) ||
        values.width < 1 ||
        values.width > 10000)
    )
      return false;
    if (!["left", "center", "right"].includes(values.align)) return false;
    // Resolve the identity on apply: a dialog must never modify another image
    // merely because pagination, selection or a remote update moved its position.
    let position: number | null = null;
    state.doc.descendants((node, pos) => {
      if (node.type.name === "image" && node.attrs.blockId === blockId)
        position = pos;
    });
    if (position == null) return false;
    const node = state.doc.nodeAt(position)!;
    const tr = closeHistory(state.tr).setNodeMarkup(position, undefined, {
      ...node.attrs,
      ...values,
    });
    dispatch?.(tr.setSelection(NodeSelection.create(tr.doc, position)));
    return true;
  };
}
