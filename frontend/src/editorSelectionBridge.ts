import type { EditorView } from "prosemirror-view";
import { projectText, selectionOffsets } from "./textProjection";

/** Give the rich editing host a text-control selection interface. React uses
 * this interface when available instead of walking every descendant before
 * each commit. ProseMirror still owns all edits and structured selections.
 * Only this editor element is adapted; no browser or React globals change. */
export function editorSelectionBridge(view: EditorView) {
  const host = view.dom;
  let saved: {
    doc: typeof view.state.doc;
    selection: typeof view.state.selection;
    start: number; end: number;
    anchor: Node; anchorOffset: number; focus: Node; focusOffset: number;
  } | null = null;
  let pendingStart: number | null = null;
  const capture = () => {
    const native = host.ownerDocument.getSelection();
    if (!native?.anchorNode || !native.focusNode ||
        !host.contains(native.anchorNode) || !host.contains(native.focusNode)) {
      saved = null;
      return selectionOffsets(view.state.doc, view.state.selection.from, view.state.selection.to);
    }
    // Reading the native endpoints also covers a pointer selection that has
    // not yet reached ProseMirror's selectionchange handler.
    let anchor: number, focus: number;
    try {
      anchor = view.posAtDOM(native.anchorNode, native.anchorOffset);
      focus = view.posAtDOM(native.focusNode, native.focusOffset);
    } catch {
      saved = null;
      return selectionOffsets(view.state.doc, view.state.selection.from, view.state.selection.to);
    }
    const offsets = selectionOffsets(view.state.doc, anchor, focus);
    saved = { doc: view.state.doc, selection: view.state.selection, ...offsets, anchor: native.anchorNode,
      anchorOffset: native.anchorOffset, focus: native.focusNode, focusOffset: native.focusOffset };
    return offsets;
  };
  const restore = (end: number) => {
    const native = host.ownerDocument.getSelection();
    const snapshot = saved;
    if (snapshot && snapshot.doc === view.state.doc && snapshot.selection.eq(view.state.selection) && pendingStart === snapshot.start && end === snapshot.end &&
        host.contains(snapshot.anchor) && host.contains(snapshot.focus)) {
      try {
        native?.setBaseAndExtent(snapshot.anchor, snapshot.anchorOffset, snapshot.focus, snapshot.focusOffset);
      } catch {
        // A decoration may have replaced its text node during the commit.
        view.focus();
      }
    } else {
      // An edit or document switch takes precedence over a stale capture.
      // focus() restores text, node and cell selections using the current state.
      view.focus();
    }
    pendingStart = null;
  };
  const descriptors: PropertyDescriptorMap = {
    selectionStart: { configurable: true, get: () => capture().start, set: (value: number) => { pendingStart = value; } },
    selectionEnd: { configurable: true, get: () => capture().end, set: restore },
    value: { configurable: true, get: () => projectText(view.state.doc).text },
  };
  Object.defineProperties(host, descriptors);
  return () => {
    for (const key of Object.keys(descriptors)) Reflect.deleteProperty(host, key);
    saved = null;
  };
}
