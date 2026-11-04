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
import { indexEntries, indexGroups, refreshedIndex } from "./documentIndex";

it("keeps one live index entry through paragraph moves, review, generation and copying", () => {
  const source = schema.node("paragraph", null, [schema.text("Marked paragraph."), schema.node("index_entry", { blockId: "entry", terms: ["Trees", "Alder"], indexGroup: "P", sortTerms: ["", "Alnus"] })]);
  const original = identifiedDocument(schema.node("doc", null, [source, schema.node("paragraph", null, schema.text("After."))]));
  const initial = EditorState.create({ doc: original, plugins: [blockIdentities()] });
  const unit = documentUnits(initial.doc).find(unit => unit.kind === "paragraph")!;
  const movement = moveArrangementUnit(initial, unit, initial.doc.content.size)!;
  const state = initial.applyTransaction(trackReviewTransaction(initial, movement.tr, { id: "indexes", author: "Reviewer", date: "" })).state;
  validateReviewMoves(state.doc);
  const entries = indexEntries(state.doc);
  expect(entries).toHaveLength(1);expect(entries[0].id).toBe("entry");
  expect(indexGroups(entries, "P").at(-1)!.ids).toEqual(["entry"]);
  const generated = refreshedIndex({ type: "table_of_contents", attrs: { kind: "index", title: "Index", indexGroup: "P", pageNumbers: true }, content: [] }, entries);
  expect(generated.content!.at(-1)!.content!.find(node => node.type === "index_reference")!.attrs!.targetIds).toEqual(["entry"]);
  expect(reviewedDocument(state.doc, "original").eq(original)).toBe(true);
  expect(reviewedDocument(state.doc, "final").eq(movement.tr.doc)).toBe(true);
  const html = document.createElement("div");html.append(DOMSerializer.fromSchema(schema).serializeFragment(state.doc.content));
  const copied = identifiedDocument(schema.node("doc", null, clipboardSlice(schema, "", html.innerHTML, "source").content));
  validateReviewMoves(copied);
  const targets = ["original", "final"].map(view => indexEntries(reviewedDocument(copied, view as "original" | "final")));
  expect(targets[0][0].id).toBe(targets[1][0].id);expect(targets[0][0].id).not.toBe("entry");
  expect(targets[0][0].terms).toEqual(["Trees", "Alder"]);expect(targets[0][0].sortTerms).toEqual(["", "Alnus"]);
});
