import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { history, undo, redo } from "prosemirror-history";
import { schema } from "./Editor";
import { changeCase, caseInputPlugin, type CaseMode } from "./caseTransform";
const p = (text: string) => schema.node("paragraph", null, schema.text(text));
describe("toolbar case changes", () => {
  it("changes only selected text and keeps its marks, with one undo", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("Keep "),
        schema.text("straße", [schema.marks.strong.create()]),
        schema.text(" unchanged"),
      ]),
    ]);
    let state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 6, 12),
      plugins: [history()],
    });
    state = state.apply(changeCase(state, "upper"));
    expect(state.doc.textContent).toBe("Keep STRASSE unchanged");
    expect(state.doc.firstChild!.child(1).marks[0].type.name).toBe("strong");
    undo(state, (tr) => {
      state = state.apply(tr);
    });
    expect(state.doc.eq(doc)).toBe(true);
  });
  it("changes the complete sandbox including text outside the selection", () => {
    const doc = schema.node("doc", null, [p("FIRST"), p("SECOND")]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1, 3),
    });
    expect(
      changeCase(state, "lower", true).doc.textBetween(
        0,
        doc.content.size,
        "\n",
      ),
    ).toBe("first\nsecond");
  });
  it("recognizes words and sentences across formatting boundaries", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("hEL", [schema.marks.strong.create()]),
        schema.text("LO world. “aNOTHER sentence.” i agree."),
      ]),
      p("NEXT paragraph"),
    ]);
    const state = EditorState.create({ doc });
    expect(changeCase(state, "sentence", true).doc.textContent).toBe(
      "Hello world. “Another sentence.” I agree.Next paragraph",
    );
    expect(changeCase(state, "title", true).doc.textContent).toBe(
      "Hello World. “Another Sentence.” I Agree.Next Paragraph",
    );
  });
});

describe("case for new writing", () => {
  it("cases new input without changing earlier text, and undo/redo retain the edit", () => {
    let mode: CaseMode = "upper";
    let state = EditorState.create({
      doc: schema.node("doc", null, [p("Keep this. ")]),
      plugins: [history(), caseInputPlugin(() => mode)],
    });
    const insert = (text: string) => {
      state = state.apply(
        state.tr.insertText(text, state.doc.content.size - 1),
      );
    };
    insert("straße");
    expect(state.doc.textContent).toBe("Keep this. STRASSE");
    undo(state, (tr) => {
      state = state.apply(tr);
    });
    expect(state.doc.textContent).toBe("Keep this. ");
    redo(state, (tr) => {
      state = state.apply(tr);
    });
    expect(state.doc.textContent).toBe("Keep this. STRASSE");
    undo(state, (tr) => {
      state = state.apply(tr);
    });
    mode = "free";
    insert("Mixed case");
    expect(state.doc.textContent).toBe("Keep this. Mixed case");
  });
  it("uses surrounding words and sentences when typing one character at a time", () => {
    for (const [kind, expected] of [
      ["sentence", "A new sentence inside it. I agree."],
      ["title", "A New Sentence Inside It. I Agree."],
    ] as const) {
      let state = EditorState.create({
        doc: schema.node("doc", null, [schema.node("paragraph")]),
        plugins: [caseInputPlugin(() => kind)],
      });
      for (const character of "a new sentence inside it. i agree.")
        state = state.apply(
          state.tr.insertText(character, state.doc.content.size - 1),
        );
      expect(state.doc.textContent).toBe(expected);
    }
  });
  it("handles repeated characters and formatted pasted paragraphs", () => {
    let state = EditorState.create({
      doc: schema.node("doc", null, [p("a")]),
      plugins: [caseInputPlugin(() => "upper")],
    });
    state = state.apply(state.tr.insertText("a", 2));
    expect(state.doc.textContent).toBe("aA");
    state = state.apply(
      state.tr.insert(3, schema.text("bold", [schema.marks.strong.create()])),
    );
    expect(state.doc.textContent).toBe("aABOLD");
    expect(state.doc.firstChild!.lastChild!.marks[0].type.name).toBe("strong");
  });
  it("waits for composition to finish before converting text", () => {
    let composing = true;
    let state = EditorState.create({
      doc: schema.node("doc", null, [schema.node("paragraph")]),
      plugins: [
        caseInputPlugin(
          () => "upper",
          () => composing,
        ),
      ],
    });
    state = state.apply(state.tr.insertText("é", 1));
    expect(state.doc.textContent).toBe("é");
    composing = false;
    state = state.apply(state.tr.setMeta("caseCompositionEnd", true));
    expect(state.doc.textContent).toBe("É");
  });
});
