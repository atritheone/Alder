// @vitest-environment jsdom
import { it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { schema } from "./Editor";
import { identifiedDocument, blockIdentities } from "./blockIdentities";
import { documentUnits, moveArrangementUnit } from "./arrangementUnits";
import { trackReviewTransaction, resolveReviewChanges, reviewedDocument, editReviewedDocument } from "./trackedReview";
import { validateReviewMoves } from "./trackedMoves";
import { pageReferenceTransaction } from "./pageReferences";
import { fieldLabels } from "./documentFields";

it("retains editable field kinds, marks and identities through both move decisions", () => {
  const fields = Object.keys(fieldLabels).map((kind, i) => schema.node("document_field", {
    fieldKind: kind, blockId: `field_${kind}`, ...(kind === "merge" && { mergeKey: "Recipient" }),
  }, schema.text(String(i + 1)), [schema.marks.strong.create()]));
  const original = identifiedDocument(schema.node("doc", null, [
    schema.node("paragraph", null, [schema.text("Moved "), ...fields]),
    schema.node("paragraph", null, schema.text("Other paragraph.")),
  ]));
  const before = EditorState.create({ doc: original, plugins: [history(), blockIdentities()] });
  const move = moveArrangementUnit(before, documentUnits(before.doc).find(u => u.kind === "paragraph")!, before.doc.content.size)!;
  const state = before.applyTransaction(trackReviewTransaction(before, move.tr, { id: "move", author: "Reviewer", date: "" })).state;
  validateReviewMoves(state.doc);
  expect(reviewedDocument(state.doc, "original").eq(original)).toBe(true);
  expect(reviewedDocument(state.doc, "final").eq(move.tr.doc)).toBe(true);
  for (const decision of ["accept", "reject"] as const) {
    const reviewed = state.applyTransaction(resolveReviewChanges(state, new Set(["move"]), decision)).state;
    expect(reviewed.doc.eq(decision === "accept" ? move.tr.doc : original)).toBe(true);
  }
  const pair: { pos: number; id: string }[] = [];
  state.doc.descendants((node, pos) => { if (node.type.name === "document_field" && node.attrs.fieldKind === "page") pair.push({ pos, id: node.attrs.blockId }); });
  expect(() => editReviewedDocument(state, state.tr.setNodeAttribute(pair[1].pos, "fieldKind", "title"))).toThrow(/Accept or reject/);
  const values = Object.fromEntries(fields.map(field => [field.attrs.blockId, field.textContent]));
  values[pair[0].id] = "1"; values[pair[1].id] = "10";
  const refreshed = state.applyTransaction(pageReferenceTransaction(state, { references: {}, fields: values, pages: 10 })!).state;
  validateReviewMoves(refreshed.doc);
  for (const [decision, expected] of [["accept", "10"], ["reject", "1"]] as const) {
    let reviewed = refreshed.applyTransaction(resolveReviewChanges(refreshed, new Set(["move"]), decision)).state;
    const pageFields: any[] = [];
    reviewed.doc.descendants(node => { if (node.type.name === "document_field" && node.attrs.fieldKind === "page") pageFields.push(node); });
    expect(pageFields).toHaveLength(1);
    expect(pageFields[0].attrs.blockId).toBe("field_page");
    expect(pageFields[0].textContent).toBe(expected);
    expect(pageFields[0].marks[0].type.name).toBe("strong");
    undo(reviewed, tr => { reviewed = reviewed.applyTransaction(tr).state; });
    expect(reviewed.doc.eq(refreshed.doc)).toBe(true);
  }
});
