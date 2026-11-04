// @vitest-environment jsdom
import { it, expect } from "vitest";
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { schema } from "./Editor";
import { editorSelectionBridge } from "./editorSelectionBridge";

it("captures pending backwards native selection and restores it without a model transaction", () => {
  const parent = document.body.appendChild(document.createElement("div"));
  const doc = schema.node("doc", null, [schema.node("paragraph", null, schema.text("First")), schema.node("paragraph", null, schema.text("Second"))]);
  const view = new EditorView(parent, { state: EditorState.create({ doc }) });
  const dispose = editorSelectionBridge(view), host = view.dom as HTMLElement & { selectionStart: number; selectionEnd: number; value: string };
  try {
    view.focus();
    const a = host.firstChild!.firstChild!, b = host.lastChild!.firstChild!;
    document.getSelection()!.setBaseAndExtent(b, 4, a, 2);
    const start = host.selectionStart, end = host.selectionEnd, state = view.state;
    expect([start, end, host.value]).toEqual([10, 2, "First\nSecond"]);
    document.getSelection()!.collapse(a, 0);
    host.selectionStart = start; host.selectionEnd = end;
    expect(document.getSelection()!.anchorNode).toBe(b);
    expect(document.getSelection()!.anchorOffset).toBe(4);
    expect(document.getSelection()!.focusNode).toBe(a);
    expect(document.getSelection()!.focusOffset).toBe(2);
    expect(view.state).toBe(state);
  } finally { dispose(); expect("selectionStart" in host).toBe(false); view.destroy(); parent.remove(); }
});

it("keeps the current structured selection when the captured document has changed", () => {
  const parent = document.body.appendChild(document.createElement("div"));
  const doc = schema.node("doc", null, [schema.node("paragraph", null, schema.text("Body")), schema.node("horizontal_rule")]);
  const view = new EditorView(parent, { state: EditorState.create({ doc, selection: TextSelection.create(doc, 2) }) });
  const dispose = editorSelectionBridge(view), host = view.dom as HTMLElement & { selectionStart: number; selectionEnd: number };
  try {
    view.focus(); const start = host.selectionStart, end = host.selectionEnd;
    const tr = view.state.tr.insertText("NEW", 1); tr.setSelection(NodeSelection.create(tr.doc, tr.doc.firstChild!.nodeSize)); view.dispatch(tr);
    host.selectionStart = start; host.selectionEnd = end;
    expect(view.state.selection).toBeInstanceOf(NodeSelection);
    expect(view.state.selection.from).toBe(9);
    expect(view.state.doc.textContent).toBe("NEWBody");
    // A selection-only command also takes precedence over the earlier capture.
    const otherStart = host.selectionStart, otherEnd = host.selectionEnd;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)));
    host.selectionStart = otherStart; host.selectionEnd = otherEnd;
    expect(view.state.selection.from).toBe(4);
    expect(document.getSelection()!.anchorOffset).toBe(3);
  } finally { dispose(); view.destroy(); parent.remove(); }
});
