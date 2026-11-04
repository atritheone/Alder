// @vitest-environment jsdom
import { it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import { schema } from "./Editor";
import { blockIdentities, identifiedDocument } from "./blockIdentities";
import { documentUnits, moveArrangementUnit } from "./arrangementUnits";
import { trackReviewTransaction, reviewedDocument } from "./trackedReview";
import { validateReviewMoves } from "./trackedMoves";
import { documentBookmarks } from "./documentBookmarks";
import { referenceIndex } from "./documentReferences";
import { DOMSerializer } from "prosemirror-model";
import { clipboardSlice } from "./pasteText";
import { moveOutlineSection } from "./documentOutline";

const stamp = { id: "bookmark_move", author: "Reviewer", date: "" };
const p = (children: any[]) => schema.node("paragraph", null, children);
it.each([false, true])("moves a complete bookmark without duplicating its navigation target (range=%s)", range => {
  const original = identifiedDocument(schema.node("doc", null, [p([
    schema.node("bookmark", { blockId: "passage", name: "Passage", range }), schema.text("Bookmarked passage."),
    ...(range ? [schema.node("bookmark_end", { blockId: "end", name: "Passage", targetId: "passage" })] : []),
  ]), p([schema.text("Other paragraph.")])]));
  const state = EditorState.create({ doc: original, plugins: [blockIdentities()] });
  const movement = moveArrangementUnit(state, documentUnits(original).find(unit => unit.kind === "paragraph")!, original.content.size)!;
  const moved = state.applyTransaction(trackReviewTransaction(state, movement.tr, stamp)).state.doc;
  validateReviewMoves(moved);
  expect(documentBookmarks(moved)).toHaveLength(1);
  expect(documentBookmarks(moved)[0]).toMatchObject({ id: "passage", name: "Passage", incomplete: false });
  expect([...referenceIndex([{ document: moved.toJSON() }]).targets.values()].filter(target => target.kind === "bookmark")).toHaveLength(1);
  expect(reviewedDocument(moved, "original").eq(original)).toBe(true);
  expect(reviewedDocument(moved, "final").eq(movement.tr.doc)).toBe(true);
  const html = document.createElement("div");html.append(DOMSerializer.fromSchema(schema).serializeFragment(moved.content));
  const copied = identifiedDocument(schema.node("doc", null, clipboardSlice(schema, "", html.innerHTML, "source").content));
  validateReviewMoves(copied);
  for (const view of ["original", "final"] as const) {
    const target = documentBookmarks(reviewedDocument(copied, view));
    expect(target).toHaveLength(1);expect(target[0].incomplete).toBe(false);expect(target[0].id).not.toBe("passage");
  }
});

it("refuses to move only one end of a bookmarked passage", () => {
  const doc = identifiedDocument(schema.node("doc", null, [p([schema.node("bookmark", { blockId: "passage", name: "Passage", range: true }), schema.text("First paragraph.")]), p([schema.text("Last paragraph."), schema.node("bookmark_end", { name: "Passage", targetId: "passage" })]), p([schema.text("Other paragraph.")])]));
  const state = EditorState.create({ doc });
  const movement = moveArrangementUnit(state, documentUnits(doc).find(unit => unit.kind === "paragraph")!, doc.content.size)!;
  expect(() => trackReviewTransaction(state, movement.tr, stamp)).toThrow(/complete bookmarked passage/);
  expect(state.doc.eq(doc)).toBe(true);
});

it.each(['paragraphs','ordered_list','table'])("moves a bookmarked passage spanning %s with its heading section", container => {
  const first = p([schema.node("bookmark", { blockId: "passage", name: "Passage", range: true }), schema.text("First paragraph.")]);
  const last = p([schema.text("Last paragraph."), schema.node("bookmark_end", { targetId: "passage", name: "Passage" })]);
  const blocks = container==='table' ? [schema.node('table',null,schema.node('table_row',null,[schema.node('table_cell',null,first),schema.node('table_cell',null,last)]))] : container==='ordered_list' ? [schema.node('ordered_list',null,[schema.node('list_item',null,first),schema.node('list_item',null,last)])] : [first,last];
  const original = identifiedDocument(schema.node("doc", null, [
    schema.node("heading", { blockId: "first", level: 1 }, schema.text("First")),
    ...blocks,
    schema.node("heading", { blockId: "second", level: 1 }, schema.text("Second")),
    p([schema.node("cross_reference", { targetId: "passage" }, schema.text("First paragraph. Last paragraph."))]),
  ]));
  const state = EditorState.create({ doc: original, plugins: [blockIdentities()] });
  const movement = moveOutlineSection(state, "first", "second", true)!;
  const moved = state.applyTransaction(trackReviewTransaction(state, movement, stamp)).state.doc;
  validateReviewMoves(moved);
  expect(referenceIndex([{ document: moved.toJSON() }]).resolve("passage")).toBe("First paragraph. Last paragraph.");
  for (const view of ["original", "final"] as const) {
    const result = reviewedDocument(moved, view);
    expect(result.eq(view === "original" ? original : movement.doc)).toBe(true);
    expect(documentBookmarks(result)).toHaveLength(1);
    expect(documentBookmarks(result)[0].incomplete).toBe(false);
  }
  const html=document.createElement('div');html.append(DOMSerializer.fromSchema(schema).serializeFragment(moved.content));
  const copied=identifiedDocument(schema.node('doc',null,clipboardSlice(schema,'',html.innerHTML,'source').content));
  validateReviewMoves(copied);
  for(const view of ['original','final'] as const){
    const result=reviewedDocument(copied,view),bookmarks=documentBookmarks(result);
    expect(bookmarks).toHaveLength(1);expect(bookmarks[0].incomplete).toBe(false);expect(bookmarks[0].id).not.toBe('passage');
    expect(referenceIndex([{document:result.toJSON()}]).resolve(bookmarks[0].id)).toBe('First paragraph. Last paragraph.');
  }
});
