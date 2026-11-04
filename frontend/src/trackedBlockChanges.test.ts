// @vitest-environment jsdom
import { it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import { history, undo, redo } from "prosemirror-history";
import { DOMSerializer } from "prosemirror-model";
import { schema, parseEditorDocument } from "./Editor";
import {
  reviewChanges,
  reviewedDocument,
  resolveReviewChanges,
} from "./trackedReview";
import { validateReviewMoves, protectPendingMoves } from "./trackedMoves";
import { documentText, projectText } from "./textProjection";
import { speechText } from "./speechText";
import { clipboardSlice } from "./pasteText";
const stamp = {
  id: "paragraph",
  author: "Reviewer",
  date: "2026-11-03T00:00:00Z",
};
const p = (text: string, kind?: "insertion" | "deletion") =>
  schema.node(
    "paragraph",
    {
      blockId: text,
      ...(kind
        ? {
            revisionBlock: {
              kind,
              stamp: { ...stamp, id: text },
              originalId: text,
            },
          }
        : {}),
    },
    text ? schema.text(text, [schema.marks.strong.create()]) : undefined,
  );
const source = () =>
  schema.node("doc", null, [
    p("Removed", "deletion"),
    p("Kept"),
    p("Added", "insertion"),
  ]);
it("reviews complete paragraphs with exact boundaries, speech, identity and undo", () => {
  const doc = source();
  validateReviewMoves(doc);
  expect(reviewChanges(doc)).toHaveLength(2);
  expect(parseEditorDocument(doc.toJSON()).document?.eq(doc)).toBe(true);
  expect(speechText(doc).text).toBe("Kept\nAdded");
  expect(documentText(doc.toJSON())).toBe("Kept\nAdded");
  expect(projectText(doc).text).toBe("Kept\nAdded");
  for (const decision of ["accept", "reject"] as const) {
    let state = EditorState.create({ doc, plugins: [history()] });
    const expected = schema.node(
      "doc",
      null,
      decision === "accept"
        ? [p("Kept"), p("Added")]
        : [p("Removed"), p("Kept")],
    );
    expect(
      reviewedDocument(doc, decision === "accept" ? "final" : "original").eq(
        expected,
      ),
    ).toBe(true);
    state = state.apply(
      resolveReviewChanges(state, new Set(["Added", "Removed"]), decision),
    );
    expect(state.doc.eq(expected)).toBe(true);
    undo(state, (tr) => (state = state.apply(tr)));
    expect(state.doc.eq(doc)).toBe(true);
    redo(state, (tr) => (state = state.apply(tr)));
    expect(state.doc.eq(expected)).toBe(true);
  }
});
it("keeps paragraph review when pasted into a paragraph and protects pending changes", () => {
  const doc = source(),
    element = document.createElement("div");
  element.appendChild(
    DOMSerializer.fromSchema(schema).serializeFragment(doc.content),
  );
  const slice = clipboardSlice(schema, "", element.innerHTML, "source");
  expect(slice.openStart).toBe(0);
  expect(slice.openEnd).toBe(0);
  const target = EditorState.create({
    doc: schema.node("doc", null, [p("Target")]),
  });
  const pasted = target.apply(target.tr.replaceSelection(slice));
  validateReviewMoves(pasted.doc);
  expect(reviewChanges(pasted.doc)).toHaveLength(2);
  expect(
    new Set(reviewChanges(pasted.doc).map((c) => c.id)).has("Removed"),
  ).toBe(false);
  const state = EditorState.create({ doc });
  expect(() =>
    protectPendingMoves(state, state.tr.insertText("x", 2)),
  ).toThrow();
});
it("retains an editable blank paragraph when every changed paragraph is removed", () => {
  for (const kind of ["insertion", "deletion"] as const) {
    const doc = schema.node("doc", null, [p("Only", kind)]),
      state = EditorState.create({ doc });
    const projected = reviewedDocument(
      doc,
      kind === "insertion" ? "original" : "final",
    );
    expect(projected.type.validContent(projected.content)).toBe(true);
    const result = state.apply(
      resolveReviewChanges(
        state,
        new Set(["Only"]),
        kind === "insertion" ? "reject" : "accept",
      ),
    );
    expect(result.doc.textContent).toBe("");
    expect(result.doc.type.validContent(result.doc.content)).toBe(true);
  }
});
