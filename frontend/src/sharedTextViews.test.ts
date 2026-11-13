// @vitest-environment jsdom
import { it, expect } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { dispatchSharedTextViews } from "./sharedTextViews";

it("shares document/history between two editable views while mapping independent selections", () => {
  const peers = new Set<EditorView>(),
    host = document.body.appendChild(document.createElement("div"));
  const state = EditorState.create({
    doc: "alpha beta",
    extensions: [history()],
  });
  const create = () => {
    const v = new EditorView({
      state,
      parent: host,
      dispatchTransactions: (trs, view) =>
        dispatchSharedTextViews(peers, trs, view),
    });
    peers.add(v);
    return v;
  };
  const a = create(),
    b = create();
  try {
    b.dispatch({ selection: { anchor: 10 } });
    a.dispatch({ selection: { anchor: 0 } });
    a.dispatch({ changes: { from: 0, insert: "X" }, userEvent: "input.type" });
    expect(a.state.doc.toString()).toBe("Xalpha beta");
    expect(b.state.doc.toString()).toBe("Xalpha beta");
    expect(b.state.selection.main.head).toBe(11);
    b.dispatch({
      changes: { from: 11, insert: "Y" },
      selection: { anchor: 12 },
      userEvent: "input.type",
    });
    expect(a.state.doc.toString()).toBe("Xalpha betaY");
    expect(undo(b)).toBe(true);
    expect(a.state.doc.toString()).toBe(b.state.doc.toString());
  } finally {
    a.destroy();
    b.destroy();
    host.remove();
  }
});
