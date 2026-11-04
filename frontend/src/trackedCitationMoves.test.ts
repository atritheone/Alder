// @vitest-environment jsdom
import { it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import { DOMSerializer } from "prosemirror-model";
import { schema } from "./Editor";
import { blockIdentities, identifiedDocument } from "./blockIdentities";
import { documentUnits, moveArrangementUnit } from "./arrangementUnits";
import { trackReviewTransaction, reviewedDocument } from "./trackedReview";
import { validateReviewMoves } from "./trackedMoves";
import { clipboardSlice } from "./pasteText";
import { applyCitationOutput, citationInput, citationNodes } from "./documentCitations";
import { processCitations } from "./citationProcessor";
import { referenceRefreshTransaction } from "./documentReferences";

it("numbers moved citations once and preserves sources through refresh, review and copy", () => {
  const citation = (id: string, value: string) => schema.node("citation", { blockId: id, items: [{ source: { id, type: "book", title: `Source ${id}`, author: [{ family: id }], issued: { "date-parts": [[2020]] } }, locator: "12", label: "page" }], renderedStyle: "ieee" }, schema.text(value));
  const original = identifiedDocument(schema.node("doc", null, [
    schema.node("paragraph", null, [schema.text("First cited paragraph."), citation("first", "[1, p. 12]")]),
    schema.node("paragraph", null, [schema.text("Other cited paragraph."), citation("second", "[2, p. 12]")]),
  ]));
  const initial = EditorState.create({ doc: original, plugins: [blockIdentities()] });
  const movement = moveArrangementUnit(initial, documentUnits(initial.doc).find(unit => unit.kind === "paragraph")!, initial.doc.content.size)!;
  let state = initial.applyTransaction(trackReviewTransaction(initial, movement.tr, { id: "citations", author: "Reviewer", date: "" })).state;
  const input = citationInput([state.doc.toJSON()], "ieee");
  expect(input.citations.map(citation => citation.id)).toEqual(["second", "first"]);
  const output = processCitations(input);expect(output.bibliography).toHaveLength(2);
  const refreshed = applyCitationOutput(state.doc.toJSON(), output, "ieee");
  state = state.applyTransaction(referenceRefreshTransaction(state, schema.nodeFromJSON(refreshed))!).state;
  validateReviewMoves(state.doc);
  const all: string[] = [];
  state.doc.descendants(node => { if (node.type.name === "citation") all.push(node.textContent); });
  expect(all).toEqual(["[2, p. 12]", "[1, p. 12]", "[2, p. 12]"]);
  for (const view of ["original", "final"] as const) {
    const citations = citationNodes(reviewedDocument(state.doc, view).toJSON());
    expect(citations).toHaveLength(2);
    expect(citations.map(node => node.attrs!.items[0].source.id)).toEqual(view === "original" ? ["first", "second"] : ["second", "first"]);
    expect(citations.every(node => node.attrs!.items[0].locator === "12")).toBe(true);
  }
  const html = document.createElement("div");html.append(DOMSerializer.fromSchema(schema).serializeFragment(state.doc.content));
  const copied = identifiedDocument(schema.node("doc", null, clipboardSlice(schema, "", html.innerHTML, "source").content));
  validateReviewMoves(copied);
  const copiedInput = citationInput([copied.toJSON()], "apa");expect(copiedInput.citations).toHaveLength(2);
  expect(copiedInput.citations.map(citation => citation.items[0].source.id)).toEqual(["second", "first"]);
  expect(copiedInput.citations.every(citation => !["first", "second"].includes(citation.id))).toBe(true);
});
