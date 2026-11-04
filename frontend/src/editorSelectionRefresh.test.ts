// @vitest-environment jsdom
import { it, expect } from "vitest";
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { schema, refreshEditorDecorations } from "./Editor";

it("preserves a structured index selection when its native range is collapsed", () => {
  const host = document.body.appendChild(document.createElement("div"));
  const doc = schema.node("doc", null, [schema.node("paragraph", null, schema.text("Body")),
    schema.node("table_of_contents", { kind: "index" }, [schema.node("paragraph", null, schema.text("Index"))])]);
  const pos = doc.firstChild!.nodeSize;
  const view = new EditorView(host, { state: EditorState.create({ schema, doc, selection: NodeSelection.create(doc, pos) }) });
  try {
    view.focus();
    document.getSelection()!.collapse(view.dom, 1);
    refreshEditorDecorations(view, false);
    expect(view.state.selection).toBeInstanceOf(NodeSelection);
    expect(view.state.selection.from).toBe(pos);
    // A genuine text selection still follows native caret changes before redraw.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, 1)));
    document.getSelection()!.collapse(view.dom.firstChild!.firstChild!, 3);
    refreshEditorDecorations(view, false);
    expect(view.state.selection.from).toBe(4);
  } finally { view.destroy(); host.remove(); }
});
