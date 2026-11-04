// @vitest-environment jsdom
import { it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import { history, undo, redo } from "prosemirror-history";
import { DOMSerializer } from "prosemirror-model";
import { schema } from "./Editor";
import { blockIdentities, identifiedDocument } from "./blockIdentities";
import { trackReviewTransaction, reviewedDocument, resolveReviewChanges } from "./trackedReview";
import { validateReviewMoves } from "./trackedMoves";
import { moveOutlineSection } from "./documentOutline";
import { normaliseListOrders, continuedLists } from "./listFormatting";
import { clipboardSlice } from "./pasteText";
import { defaultListTemplate, outlineListLayout, outlinePreviewFragment } from "./outlineLists";

const stamp = { id: "list_move", author: "Reviewer", date: "" };
const p = (text: string) => schema.node("paragraph", { spaceAfter: 7 }, [schema.text(text, [schema.marks.strong.create()])]);
const item = (text: string, nested = false) => schema.node("list_item", null, [p(text), ...(nested ? [schema.node("bullet_list", { listStyle: "square" }, [schema.node("list_item", null, p("Nested item"))])] : [])]);
const heading = (id: string) => schema.node("heading", { blockId: id, level: 1 }, schema.text(id));
const initial = () => normaliseListOrders(identifiedDocument(schema.node("doc", null, [
  heading("first"), schema.node("ordered_list", { order: 3, listStyle: "upper-alpha" }, [item("First item", true), item("Second item")]),
  heading("second"), schema.node("ordered_list", { continuePrevious: true, listStyle: "upper-alpha" }, [item("Other item")]),
])));

it("moves an outline section containing a nested list with identities, numbering and review intact", () => {
  const original = initial();
  let state = EditorState.create({ doc: original, plugins: [history(), blockIdentities(), continuedLists()] });
  const move = moveOutlineSection(state, "first", "second", true)!;
  const expected = state.applyTransaction(move).state.doc;
  state = state.applyTransaction(trackReviewTransaction(state, move, stamp)).state;
  validateReviewMoves(state.doc);
  const moved = state.doc, ids: string[] = [];
  moved.descendants(n => { if (n.attrs.blockId) ids.push(n.attrs.blockId); });
  expect(new Set(ids).size).toBe(ids.length);
  expect(reviewedDocument(moved, "original").eq(original)).toBe(true);
  expect(reviewedDocument(moved, "final").eq(expected)).toBe(true);
  for (const decision of ["accept", "reject"] as const) {
    const resolved = state.applyTransaction(resolveReviewChanges(state, new Set([stamp.id]), decision)).state.doc;
    expect(resolved.eq(decision === "accept" ? expected : original)).toBe(true);
  }
  undo(state, tr => state = state.applyTransaction(tr).state); expect(state.doc.eq(original)).toBe(true);
  redo(state, tr => state = state.applyTransaction(tr).state); expect(state.doc.eq(moved)).toBe(true);
  const host = document.createElement("div");host.append(DOMSerializer.fromSchema(schema).serializeFragment(moved.content));
  const copied = schema.node("doc", null, clipboardSlice(schema, "", host.innerHTML, "source").content);
  validateReviewMoves(copied);
  expect(reviewedDocument(copied, "final").textContent).toBe(expected.textContent);
});

it("rejects overlapping changes or objects in a moved list without modifying the source", () => {
  const doc = initial();
  const list = doc.child(1), first = list.child(0), text = first.child(0);
  const changed = schema.node("doc", null, [doc.firstChild!, schema.node("ordered_list", list.attrs, [schema.node("list_item", null, schema.node("paragraph", text.attrs, schema.node("comment_anchor", { threadId: "comment" })))]), doc.child(2), doc.child(3)]);
  // Explicitly malformed/unsupported list prose must never be flattened by tracking.
  const state = EditorState.create({ doc: changed });
  const move = moveOutlineSection(state, "first", "second", true)!;
  expect(() => trackReviewTransaction(state, move, stamp)).toThrow();
  expect(state.doc).toBe(changed);
});

it("numbers a moved outline template from its live position and restores nested restart rules", () => {
  const template = defaultListTemplate();
  template[0] = { ...template[0], format: "upper-alpha" };
  template[1] = { ...template[1], format: "lower-alpha", pattern: "%1(%2)", restart: 0 };
  const doc = initial();
  const original = schema.node("doc", null, [doc.child(0), schema.node("ordered_list", { ...doc.child(1).attrs, listTemplate: template }, doc.child(1).content), doc.child(2), schema.node("ordered_list", { ...doc.child(3).attrs, listTemplate: template }, doc.child(3).content)]);
  let state = EditorState.create({ doc: original, plugins: [history(), continuedLists()] });
  const move = moveOutlineSection(state, "first", "second", true)!;
  state = state.applyTransaction(trackReviewTransaction(state, move, stamp)).state;
  validateReviewMoves(state.doc);
  const labels = (doc: typeof original) => outlineListLayout(doc).markers.map(m => m.label);
  expect(labels(state.doc)).toEqual(["C.", "C(a)", "D.", "A.", "C.", "C(a)", "D."]);
  expect(labels(reviewedDocument(state.doc, "original"))).toEqual(["C.", "C(a)", "D.", "E."]);
  expect(labels(reviewedDocument(state.doc, "final"))).toEqual(["A.", "C.", "C(a)", "D."]);
  for (const mode of ["markup", "original", "final"] as const) {
    const doc = reviewedDocument(state.doc, mode), preview = document.createElement("div");
    preview.append(outlinePreviewFragment(doc));
    expect([...preview.querySelectorAll('[data-outline-number]')].map(n => n.textContent!.trim())).toEqual(labels(doc));
    expect(preview.querySelectorAll('strong')).toHaveLength(mode === "markup" ? 7 : 4);
  }
  expect(state.applyTransaction(resolveReviewChanges(state, new Set([stamp.id]), "reject")).state.doc.eq(original)).toBe(true);
});
