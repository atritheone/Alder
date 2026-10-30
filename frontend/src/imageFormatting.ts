import {
  NodeSelection,
  type Command,
  type EditorState,
} from "prosemirror-state";
import { closeHistory } from "prosemirror-history";
import { imageCrop, type ImageCrop } from "./imageCrop";
import { imageWrapping, type ImageWrap } from "./imageWrapping";

export function selectedImage(state: EditorState) {
  const selection = state.selection;
  return selection instanceof NodeSelection &&
    ["image", "inline_image"].includes(selection.node.type.name)
    ? { node: selection.node, pos: selection.from }
    : null;
}

export function setImageProperties(
  blockId: string,
  values: {
    width: number | null;
    align: string;
    alt: string;
    decorative?: boolean;
    title: string | null;
    assetId?: string;
    src?: string;
    placement?: "inline" | "block";
    crop?: ImageCrop | null;
    wrap?: ImageWrap;
    wrapGap?: number;
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
    if (values.decorative != null && typeof values.decorative !== "boolean")
      return false;
    try {
      imageCrop(values.crop);
      imageWrapping(values);
    } catch {
      return false;
    }
    // Resolve the identity on apply: a dialog must never modify another image
    // merely because pagination, selection or a remote update moved its position.
    let position: number | null = null;
    state.doc.descendants((node, pos) => {
      if (
        ["image", "inline_image"].includes(node.type.name) &&
        node.attrs.blockId === blockId
      )
        position = pos;
    });
    if (position == null) return false;
    const node = state.doc.nodeAt(position)!;
    const { placement: requestedPlacement, ...properties } = values;
    const placement =
      requestedPlacement ??
      (values.wrap && values.wrap !== "none" ? "inline" : undefined);
    if (placement && !["inline", "block"].includes(placement)) return false;
    const attrs = {
      ...node.attrs,
      ...properties,
    };
    if (placement === "block") attrs.wrap = "none";
    const tr = closeHistory(state.tr);
    if (!placement || (placement === "inline") === node.isInline) {
      tr.setNodeMarkup(position, undefined, attrs);
    } else if (placement === "inline") {
      // Preserve the standalone paragraph's place, rather than unexpectedly
      // merging it into neighbouring prose. The image can then move with text.
      const paragraph = state.schema.nodes.paragraph.create(
        { align: attrs.align },
        state.schema.nodes.inline_image.create(attrs),
      );
      tr.replaceWith(position, position + node.nodeSize, paragraph);
    } else {
      // ProseMirror splits the containing text block while retaining its marks
      // and formatting on either side, including inside lists and table cells.
      tr.replaceRangeWith(
        position,
        position + node.nodeSize,
        state.schema.nodes.image.create(attrs),
      );
    }
    let selected = -1;
    tr.doc.descendants((n, pos) => {
      if (
        ["image", "inline_image"].includes(n.type.name) &&
        n.attrs.blockId === blockId
      )
        selected = pos;
    });
    if (selected < 0) return false;
    // A wrapped picture is anchored to the start of its paragraph. Keeping it
    // in the authored paragraph makes text moves, undo and exchange carry the
    // picture without a second, fallible identity lookup during reflow.
    if (attrs.wrap && attrs.wrap !== "none") {
      const anchor = tr.doc.resolve(selected);
      if (anchor.parent.isTextblock && anchor.parentOffset > 0) {
        const picture = tr.doc.nodeAt(selected)!;
        tr.delete(selected, selected + picture.nodeSize).insert(
          anchor.start(),
          picture,
        );
        selected = anchor.start();
      }
    }
    dispatch?.(
      tr.setSelection(NodeSelection.create(tr.doc, selected)).scrollIntoView(),
    );
    return true;
  };
}
