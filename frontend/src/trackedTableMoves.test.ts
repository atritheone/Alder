// @vitest-environment jsdom
import { it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import { DOMSerializer } from "prosemirror-model";
import { history, undo, redo } from "prosemirror-history";
import { schema } from "./Editor";
import { blockIdentities, identifiedDocument } from "./blockIdentities";
import { moveOutlineSection } from "./documentOutline";
import { trackReviewTransaction, reviewedDocument, resolveReviewChanges } from "./trackedReview";
import { validateReviewMoves } from "./trackedMoves";
import { clipboardSlice } from "./pasteText";

const p = (text: string) => schema.node("paragraph", null, schema.text(text, [schema.marks.strong.create()]));
const heading = (id: string) => schema.node("heading", { level: 1, blockId: id }, schema.text(id));
const original = () => identifiedDocument(schema.node("doc", null, [heading("first"),
  schema.node("table", { blockId: "grid", align: "center" }, [
    schema.node("table_row", null, schema.node("table_header", { colspan: 2, colwidth: [140, 180], background: "#ddeeff" }, p("Merged header"))),
    schema.node("table_row", { minHeight: 40, allowSplit: true }, [
      schema.node("table_cell", { colwidth: [140], verticalAlign: "bottom" }, schema.node("ordered_list", { order: 3 }, schema.node("list_item", null, p("List cell")))),
      schema.node("table_cell", { colwidth: [180] }, schema.node("table", null, schema.node("table_row", null, schema.node("table_cell", null, p("Nested table"))))),
    ]),
  ]),
  schema.node("paragraph", { captionLabel: "Table", captionTargetId: "grid", blockId: "caption" }, schema.text("Attached caption")),
  heading("second"), p("Other section"),
]));
const stamp = { id: "table_move", author: "Reviewer", date: "" };
it("moves merged/nested tables and their caption as one review group with exact identities", () => {
  const before = original();let state = EditorState.create({ doc: before, plugins: [history(), blockIdentities()] });
  const move = moveOutlineSection(state, "first", "second", true)!;
  const after = state.applyTransaction(move).state.doc;
  state = state.applyTransaction(trackReviewTransaction(state, move, stamp)).state;
  const pending = state.doc;validateReviewMoves(pending);
  const ids: string[] = [];pending.descendants(n => { if (n.attrs.blockId) ids.push(n.attrs.blockId); });
  expect(new Set(ids).size).toBe(ids.length);
  expect(pending.child(2).attrs.captionTargetId).toBe(pending.child(1).attrs.blockId);
  expect(pending.lastChild!.attrs.captionTargetId).toBe("grid");
  expect(reviewedDocument(pending, "original").eq(before)).toBe(true);
  expect(reviewedDocument(pending, "final").eq(after)).toBe(true);
  for (const decision of ["accept", "reject"] as const)
    expect(state.applyTransaction(resolveReviewChanges(state, new Set([stamp.id]), decision)).state.doc.eq(decision === "accept" ? after : before)).toBe(true);
  undo(state, tr => state = state.applyTransaction(tr).state);expect(state.doc.eq(before)).toBe(true);
  redo(state, tr => state = state.applyTransaction(tr).state);expect(state.doc.eq(pending)).toBe(true);
  const html = document.createElement("div");html.append(DOMSerializer.fromSchema(schema).serializeFragment(pending.content));
  const pasted = schema.node("doc", null, clipboardSlice(schema, "", html.innerHTML, "source").content);
  validateReviewMoves(pasted);
  expect(reviewedDocument(pasted, "final").textContent).toBe(after.textContent);
});

it("refuses an overlapping change in a nested table before modifying the source", () => {
  const before = original(), state = EditorState.create({ doc: before });
  let at = 0;before.descendants((n, pos) => { if (n.isText && n.text === "Nested table") at = pos; });
  const changed = state.apply(state.tr.addMark(at, at + 6, schema.marks.revision_insertion.create({ id: "other", author: "Other", date: "" })));
  const move = moveOutlineSection(changed, "first", "second", true)!;
  expect(() => trackReviewTransaction(changed, move, stamp)).toThrow();
});
