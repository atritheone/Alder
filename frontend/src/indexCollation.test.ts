// @vitest-environment jsdom
import { it, expect } from "vitest";
import { EditorState, NodeSelection } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { DOMSerializer } from "prosemirror-model";
import { schema } from "./Editor";
import { indexGroups, refreshedIndex } from "./documentIndex";
import { insertContents } from "./documentContents";
import { validIndexLanguage } from "./indexCollation";
import { clipboardSlice } from "./pasteText";
import type { DocNode } from "./types";

const entries = ["Örebro", "Aachen", "Åland", "Zebra", "Älmhult"].map((term, i) => ({ id: String(i), terms: [term] }));
it("sorts each hierarchy level by language without losing sort text or equivalent Unicode", () => {
  const order = (language: string) => indexGroups(entries, null, true, language).map(g => g.terms[0]);
  expect(order("sv-SE")).toEqual(["Aachen", "Zebra", "Åland", "Älmhult", "Örebro"]);
  expect(order("en-US")).toEqual(["Aachen", "Åland", "Älmhult", "Örebro", "Zebra"]);
  expect(indexGroups(entries.map(e => ({ ...e, terms: ["Places", ...e.terms] })), null, true, "sv-SE").slice(1).map(g => g.terms[1])).toEqual(order("sv-SE"));
  expect(indexGroups(entries.map((e, i) => i ? e : { ...e, sortTerms: ["Before"] }), null, true, "sv-SE").slice(0, 3).map(g => g.terms[0])).toEqual(["Aachen", "Örebro", "Zebra"]);
  expect(indexGroups([{ id: "a", terms: ["é"] }, { id: "b", terms: ["e\u0301"] }], null, true, "fr-FR").map(g => g.ids)).toEqual([["b"], ["a"]]);
  for (const value of ["zz-ZZ", "en_US", "", "sv;evil"]) expect(validIndexLanguage(value)).toBe(false);
});

it("retains index language and entry formatting through refresh, clipboard and undo", () => {
  const index: DocNode = refreshedIndex({ type: "table_of_contents", attrs: { kind: "index", title: "Index", depth: 3, entryStyle: null, indexLanguage: "sv-SE" } }, entries);
  index.content![2].attrs!.fontSize = 17; // Zebra follows Aachen in Swedish.
  const changed = refreshedIndex({ ...index, attrs: { ...index.attrs, indexLanguage: "en-US" } }, entries);
  expect(changed.content!.at(-1)!.attrs!.fontSize).toBe(17);
  let state = EditorState.create({ schema, doc: schema.node("doc", null, [schema.nodeFromJSON(index)]), plugins: [history()] });
  const before = state.doc;
  state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0)));
  state = state.apply(insertContents(state, changed));
  expect(state.doc.firstChild!.attrs.indexLanguage).toBe("en-US");
  undo(state, tr => state = state.apply(tr));
  expect(state.doc.eq(before)).toBe(true);
  const host = document.createElement("div");
  host.append(DOMSerializer.fromSchema(schema).serializeFragment(state.doc.content));
  const copied = clipboardSlice(schema, "", host.innerHTML, "source");
  expect(copied.content.firstChild!.attrs.indexLanguage).toBe("sv-SE");
  expect(copied.content.firstChild!.textContent).toBe(before.firstChild!.textContent);
});
