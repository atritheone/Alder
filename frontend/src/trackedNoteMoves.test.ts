// @vitest-environment jsdom
import { it, expect } from "vitest";
import { DOMSerializer } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { schema, parseEditorDocument } from "./Editor";
import { blockIdentities, identifiedDocument } from "./blockIdentities";
import { documentUnits, moveArrangementUnit } from "./arrangementUnits";
import { trackReviewTransaction, reviewedDocument, resolveReviewChanges, editReviewedDocument } from "./trackedReview";
import { validateReviewMoves } from "./trackedMoves";
import { documentNotes, noteReferenceNumbers, chapterNoteStarts } from "./documentNotes";
import { speechText } from "./speechText";
import { clipboardSlice } from "./pasteText";
import type { Project } from "./types";

const stamp = { id: "note_move", author: "Reviewer", date: "2026-11-03T00:00:00Z" };
const paragraph = (text: string) => schema.node("paragraph", null, schema.text(text));
it.each(["footnote", "endnote"] as const)("moves a %s and its complete story with stable review identities", kind => {
  for (const backwards of [false, true]) {
    const note = (id: string) => schema.node("document_note", { blockId: id, kind, body: {
      type: "doc", content: [
        { type: "paragraph", content: [{ type: "text", text: `NOTE_${id}`, marks: [{ type: "strong" }] }] },
        { type: "ordered_list", attrs: { order: 3 }, content: [{ type: "list_item", content: [{ type: "paragraph", content: [{ type: "text", text: "Nested wording." }] }] }] },
      ],
    } });
    const rich = schema.node("paragraph", { blockId: "moved" }, [schema.text("Moved paragraph."), note("moved_note")]);
    const other = schema.node("paragraph", null, [schema.text("Other paragraph."), note("other_note")]);
    const original = identifiedDocument(schema.node("doc", null, backwards ? [other, rich] : [rich, other]));
    let state = EditorState.create({ doc: original, plugins: [history(), blockIdentities()] });
    const units = documentUnits(state.doc).filter(unit => unit.kind === "paragraph");
    const movement = moveArrangementUnit(state, units[backwards ? 1 : 0], backwards ? 0 : state.doc.content.size)!;
    state = state.applyTransaction(trackReviewTransaction(state, movement.tr, stamp)).state;
    validateReviewMoves(state.doc);
    expect(parseEditorDocument(state.doc.toJSON()).document?.eq(state.doc)).toBe(true);
    const notes = documentNotes(state.doc);
    expect(notes).toHaveLength(2);
    expect(notes.map(n => n.number)).toEqual(kind === "footnote" ? ["1", "2"] : ["i", "ii"]);
    const refs = noteReferenceNumbers(state.doc);
    expect(refs).toHaveLength(3);
    expect(refs[2].number).toBe(notes.find(n => n.id === "moved_note")!.number);
    const project = { settings: {}, book: { chapters: [{ id: "first", document: state.doc.toJSON() }, { id: "second" }] } } as Project;
    expect(chapterNoteStarts(project, "second")[kind]).toBe(2);
    const ids: string[] = [];
    state.doc.descendants(node => {
      if (node.attrs.blockId) ids.push(node.attrs.blockId);
      if (node.type.name === "document_note") schema.nodeFromJSON(node.attrs.body).descendants(child => { if (child.attrs.blockId) ids.push(child.attrs.blockId); });
    });
    expect(new Set(ids).size).toBe(ids.length);
    for (const view of ["original", "final"] as const) {
      const expected = view === "original" ? original : movement.tr.doc;
      expect(reviewedDocument(state.doc, view).eq(expected)).toBe(true);
      expect(speechText(reviewedDocument(state.doc, view), 0, undefined, true).text).toBe(speechText(expected, 0, undefined, true).text);
    }
    expect(speechText(state.doc, 0, undefined, true).text).toBe(speechText(movement.tr.doc, 0, undefined, true).text);
    const moved = notes.find(n => n.id === "moved_note")!;
    expect(() => editReviewedDocument(state, state.tr.setNodeAttribute(moved.pos, "body", { type: "doc", content: [paragraph("Changed").toJSON()] }))).toThrow(/Accept or reject/);
    for (const decision of ["accept", "reject"] as const) {
      let decided = state.applyTransaction(resolveReviewChanges(state, new Set([stamp.id]), decision)).state;
      expect(decided.doc.eq(decision === "accept" ? movement.tr.doc : original)).toBe(true);
      undo(decided, tr => { decided = decided.applyTransaction(tr).state; });
      expect(decided.doc.eq(state.doc)).toBe(true);
    }
    const html = document.createElement("div");
    html.append(DOMSerializer.fromSchema(schema).serializeFragment(state.doc.content));
    const copy = identifiedDocument(schema.node("doc", null, clipboardSlice(schema, "", html.innerHTML, "source").content));
    validateReviewMoves(copy);
    const copiedBodies = ["original", "final"].map(view => documentNotes(reviewedDocument(copy, view as "original" | "final")).map(n => ({ id: n.id, body: n.value.body })).sort((a, b) => a.id.localeCompare(b.id)));
    expect(copiedBodies[0]).toEqual(copiedBodies[1]);
    expect(copiedBodies[0].some(n => n.id === "moved_note")).toBe(false);
  }
});
