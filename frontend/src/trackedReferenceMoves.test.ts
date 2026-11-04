// @vitest-environment jsdom
import { it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import { DOMSerializer } from "prosemirror-model";
import { schema } from "./Editor";
import { blockIdentities, identifiedDocument } from "./blockIdentities";
import { documentUnits, moveArrangementUnit } from "./arrangementUnits";
import { trackReviewTransaction, reviewedDocument, editReviewedDocument } from "./trackedReview";
import { validateReviewMoves } from "./trackedMoves";
import { clipboardSlice } from "./pasteText";
import { referenceIndex, refreshedReferences, referenceRefreshTransaction } from "./documentReferences";

it("does not mistake authored paragraphs ending in references for wrapped plain text", () => {
  const first = schema.node("paragraph", null, [schema.text("An authored paragraph with a sufficiently long reference to "), schema.node("cross_reference", { targetId: "target" }, schema.text("Heading"))]);
  const last = schema.node("paragraph", null, schema.text("Another distinct authored paragraph."));
  expect(documentUnits(schema.node("doc", null, [first,last])).filter(unit => unit.kind === "paragraph")).toHaveLength(2);
});

it("retains reference targets and formatting across moves, refreshes and copies", () => {
  const target = schema.node("heading", { blockId: "target", level: 1, headingNumbered: true }, schema.text("Original heading"));
  const source = schema.node("paragraph", null, [schema.text("See "), ...["text", "number", "page"].map((format, i) => schema.node("cross_reference", { targetId: "target", blockId: `ref_${i}`, referenceFormat: format }, schema.text(format === "text" ? "Original heading" : "1"), [schema.marks.strong.create()]))]);
  const original = identifiedDocument(schema.node("doc", null, [target, source, schema.node("paragraph", null, schema.text("After."))]));
  const initial = EditorState.create({ doc: original, plugins: [blockIdentities()] });
  const unit = documentUnits(initial.doc).find(unit => unit.kind === "paragraph" && unit.from === target.nodeSize)!;
  const movement = moveArrangementUnit(initial, unit, initial.doc.content.size)!;
  let state = initial.applyTransaction(trackReviewTransaction(initial, movement.tr, { id: "refs", author: "Reviewer", date: "" })).state;
  validateReviewMoves(state.doc);
  expect(reviewedDocument(state.doc, "original").eq(original)).toBe(true);
  expect(reviewedDocument(state.doc, "final").eq(movement.tr.doc)).toBe(true);
  state = state.applyTransaction(editReviewedDocument(state, state.tr.insertText("Updated heading", 1, target.nodeSize - 1))).state;
  const json = state.doc.toJSON(), next = refreshedReferences(json, referenceIndex([{ document: json }]));
  state = state.applyTransaction(referenceRefreshTransaction(state, schema.nodeFromJSON(next))!).state;
  validateReviewMoves(state.doc);
  for (const view of ["original", "final"] as const) {
    const doc = reviewedDocument(state.doc, view), refs: any[] = [];
    doc.descendants(node => { if (node.type.name === "cross_reference") refs.push(node); });
    expect(refs.map(node => node.attrs.targetId)).toEqual(["target", "target", "target"]);
    expect(refs[0].textContent).toBe("Updated heading");
    expect(refs.every(node => node.marks[0].type.name === "strong")).toBe(true);
  }
  const html = document.createElement("div");html.append(DOMSerializer.fromSchema(schema).serializeFragment(state.doc.content));
  const copied = identifiedDocument(schema.node("doc", null, clipboardSlice(schema, "", html.innerHTML, "source").content));
  validateReviewMoves(copied);
  const targets = ["original", "final"].map(view => {
    const doc = reviewedDocument(copied, view as "original" | "final"), ids: string[] = [];
    doc.descendants(node => { if (node.type.name === "cross_reference") ids.push(node.attrs.targetId); });
    expect(ids.every(id => id === doc.firstChild!.attrs.blockId)).toBe(true);
    return ids;
  });
  expect(targets[0]).toEqual(targets[1]);expect(targets[0][0]).not.toBe("target");
});
