// @vitest-environment jsdom
import { expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { schema } from "./Editor";
import { structureMarks } from "./structureMarks";
import { projectText } from "./textProjection";

it("keeps symbols out of text, stored content and selections while reusing unchanged marks", () => {
  const host = document.body.appendChild(document.createElement("div"));
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [
      schema.text("One two\tthree\u00a0four"),
      schema.node("hard_break"),
      schema.text("五"),
    ]),
    schema.node("paragraph"),
  ]);
  const view = new EditorView(host, {
    state: EditorState.create({ doc, plugins: [structureMarks(() => true)] }),
  });
  try {
    const json = JSON.stringify(doc.toJSON()),
      text = projectText(doc).text;
    const symbols = [
      ...view.dom.querySelectorAll<HTMLElement>("[data-symbol]"),
    ].map((element) => element.dataset.symbol);
    expect(symbols).toEqual(["·", "→", "°", "↵", "¶", "¶"]);
    expect(view.dom.textContent).toBe("One two\tthree\u00a0four五");
    const first = view.dom.firstChild;
    const marker = view.dom.querySelector(".structure-marker");
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)),
    );
    host.classList.add("show-structure");
    host.classList.remove("show-structure");
    expect(view.dom.firstChild).toBe(first);
    expect(view.dom.querySelector(".structure-marker")).toBe(marker);
    expect(view.state.selection.from).toBe(3);
    expect(JSON.stringify(view.state.doc.toJSON())).toBe(json);
    expect(projectText(view.state.doc).text).toBe(text);
    // A later edit offsets an unchanged paragraph without losing its empty mark.
    const emptyMarker = view.dom.querySelectorAll('[data-kind="paragraph"]')[1];
    view.dispatch(view.state.tr.insertText("inserted ", 1));
    expect(view.dom.querySelectorAll('[data-kind="paragraph"]')).toHaveLength(
      2,
    );
    expect(view.dom.querySelectorAll('[data-kind="paragraph"]')[1]).toBe(emptyMarker);
  } finally {
    view.destroy();
    host.remove();
  }
});

it("bounds whitespace overlays in long documents without changing paragraph markers or content", () => {
  const host = document.body.appendChild(document.createElement("div"));
  const doc = schema.node("doc", null, Array.from({ length: 500 }, () =>
    schema.node("paragraph", null, schema.text("word ".repeat(100)))));
  const view = new EditorView(host, {
    state: EditorState.create({ doc, plugins: [structureMarks(() => true)] }),
  });
  try {
    expect(view.dom.querySelectorAll('[data-kind="paragraph"]')).toHaveLength(500);
    expect(view.dom.querySelectorAll('.structure-whitespace').length).toBeLessThan(1700);
    expect(view.state.doc).toBe(doc);
  } finally {
    view.destroy(); host.remove();
  }
});
