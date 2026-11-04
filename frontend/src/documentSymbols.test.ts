import { expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { history, undo, redo, closeHistory } from "prosemirror-history";
import { schema } from "./Editor";
import {
  insertSymbol,
  findSymbols,
  symbolFromCode,
  symbolCode,
  symbolCatalogue,
} from "./documentSymbols";

it("replaces the captured selection with ordinary formatted Unicode in one undo step", () => {
  const doc = schema.node("doc", null, [
    schema.node(
      "paragraph",
      null,
      schema.text("Before old after", [schema.marks.strong.create()]),
    ),
  ]);
  let state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, 8, 11),
    plugins: [history()],
  });
  const saved = state.selection;
  state = state.apply(state.tr.setSelection(TextSelection.create(doc, 1)));
  state = state.apply(insertSymbol(state, "Ω", saved));
  state = state.apply(closeHistory(state.tr));
  expect(state.doc.textContent).toBe("Before Ω after");
  expect(
    state.doc.firstChild!.child(0).marks.map((m) => m.type.name),
  ).toContain("strong");
  undo(state, (tr) => {
    state = state.apply(tr);
  });
  expect(state.doc.eq(doc)).toBe(true);
  redo(state, (tr) => {
    state = state.apply(tr);
  });
  expect(state.doc.textContent).toBe("Before Ω after");
});
it("inserts supplementary characters and respects the originating typing marks", () => {
  let state = EditorState.create({ schema });
  state = state.apply(
    insertSymbol(state, "𝄞", state.selection, [schema.marks.em.create()]),
  );
  expect(state.doc.textContent).toBe("𝄞");
  expect(state.doc.firstChild!.firstChild!.marks[0].type.name).toBe("em");
  expect(state.selection.from).toBe(3);
});
it("validates complete Unicode scalar values while preserving useful spacing symbols", () => {
  for (const value of [
    "U+D800",
    "U+0009",
    "U+0085",
    "U+FDD0",
    "U+10FFFF",
    "U+110000",
    "abc xyz",
    "U+2014;alert(1)",
  ])
    expect(symbolFromCode(value)).toBeNull();
  for (const value of ["—", "Ω", "😀", "\u00a0", "\u00ad", "\u202f"])
    expect(symbolFromCode(symbolCode(value))).toBe(value);
  const state = EditorState.create({ schema });
  expect(() => insertSymbol(state, "two")).toThrow(/Unicode/);
  expect(() => insertSymbol(state, "\ud800")).toThrow(/Unicode/);
});
it("finds named symbols, characters and Unicode codes without changing their values", () => {
  expect(findSymbols("em dash").map((s) => s.value)).toContain("—");
  expect(findSymbols("U+03A9", "Greek").map((s) => s.value)).toEqual(["Ω"]);
  expect(findSymbols("Ω", "Currency")).toEqual([]);
  expect(new Set(symbolCatalogue.map((s) => s.value)).size).toBe(
    symbolCatalogue.length,
  );
});
