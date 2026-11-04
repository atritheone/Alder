// Isolated native-selection fixture; never included in the application build.
import { useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { EditorState, NodeSelection, TextSelection, Plugin } from "prosemirror-state";
import { EditorView, Decoration, DecorationSet } from "prosemirror-view";
import { CellSelection } from "prosemirror-tables";
import { schema } from "../frontend/src/Editor";
import { editorSelectionBridge } from "../frontend/src/editorSelectionBridge";
const host = document.body.appendChild(document.createElement("div"));
host.style.cssText = "position:fixed;inset:0;z-index:999999;background:#ddd;padding:80px";
const p = (text: string) => schema.node("paragraph", null, schema.text(text));
const doc = schema.node("doc", null, [p("First paragraph"), p("Second paragraph"), schema.node("horizontal_rule"), schema.node("table", null, schema.node("table_row", null, [schema.node("table_cell", null, p("Left cell")), schema.node("table_cell", null, p("Right cell"))]))]);
function Probe() {
  const node = useRef<HTMLDivElement>(null), view = useRef<EditorView | null>(null), [flipped, setFlipped] = useState(false);
  useLayoutEffect(() => {
    const v = view.current = new EditorView(node.current!, { state: EditorState.create({ doc, plugins: [new Plugin({ props: { decorations: state => DecorationSet.create(state.doc, [Decoration.widget(5, () => {
      const marker = document.createElement("span"); marker.setAttribute("aria-hidden", "true"); marker.textContent = "\u00ad"; return marker;
    }, { side: -1, ignoreSelection: true })]) } })] }) });
    const cleanup = editorSelectionBridge(v);
    return () => { cleanup(); v.destroy(); view.current = null; };
  }, []);
  (window as any).__selectionBridgeProbe = async (mode: string) => {
    const v = view.current!;
    const second = doc.firstChild!.nodeSize, rule = second + doc.child(1).nodeSize;
    let selection = TextSelection.create(doc, second + 5, 3);
    if (mode === "node") selection = NodeSelection.create(doc, rule) as any;
    if (mode === "cells") {
      const cells: number[] = []; doc.descendants((n, pos) => { if (n.type.name === "table_cell") cells.push(pos); });
      selection = CellSelection.create(doc, cells[0], cells[1]) as any;
    }
    v.dispatch(v.state.tr.setSelection(selection)); v.focus();
    const native = document.getSelection()!;
    if (mode === "pending") {
      const a = v.domAtPos(2), b = v.domAtPos(second + 8);
      native.setBaseAndExtent(b.node, b.offset, a.node, a.offset);
    }
    const before = { anchor: native.anchorNode, anchorOffset: native.anchorOffset, focus: native.focusNode, focusOffset: native.focusOffset, text: native.toString(), model: JSON.stringify(v.state.selection.toJSON()) };
    flushSync(() => setFlipped(value => !value));
    await new Promise(resolve => requestAnimationFrame(resolve));
    return { focused: document.activeElement === v.dom, endpoints: native.anchorNode === before.anchor && native.anchorOffset === before.anchorOffset && native.focusNode === before.focus && native.focusOffset === before.focusOffset,
      text: native.toString(), expectedText: before.text, model: JSON.stringify(v.state.selection.toJSON()), expectedModel: before.model };
  };
  const editor = <div key="editor" ref={node} />;
  const button = <button key="other">Other element</button>;
  return <div>{flipped ? [button, editor] : [editor, button]}</div>;
}
createRoot(host).render(<Probe />);
