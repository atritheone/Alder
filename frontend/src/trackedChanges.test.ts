import { expect, it } from "vitest";
import { Schema } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { history, undo, redo } from "prosemirror-history";
import { projectText, projectedRange, documentText } from "./textProjection";
import { speechText } from "./speechText";
import { replaceMatches } from "./findText";
import { proofreadingTransaction } from "./proofreadingEdits";
import { schema as editorSchema } from "./Editor";
import {
  revisionMarkSpec,
  trackInlineTransaction,
  reviewDocument,
  documentChanges,
  resolveChanges,
} from "./trackedChanges";
const schema = new Schema({
  nodes: editorSchema.spec.nodes,
  marks: editorSchema.spec.marks.append({
    revision_insertion: revisionMarkSpec("insertion"),
    revision_deletion: revisionMarkSpec("deletion"),
  }),
});
const stamp = {
  id: "change_one",
  author: "Reviewer",
  date: "2026-10-29T01:00:00Z",
};
it("narration and counts exclude deleted text while correction ranges retain it", () => {
  let state = initial();
  state = state.apply(
    trackInlineTransaction(state, state.tr.insertText("Changed", 1, 9), stamp),
  );
  expect(projectText(state.doc).text).toBe("Changed wording.");
  expect(documentText(state.doc.toJSON())).toBe("Changed wording.");
  expect(speechText(state.doc).text).toBe("Changed wording.");
  expect(projectedRange(state.doc, 0, 7)).toEqual({ from: 9, to: 16 });
  const p = schema.node("paragraph", null, [
    schema.text("ab"),
    schema.text("deleted", [schema.marks.revision_deletion.create(stamp)]),
    schema.text("cd"),
  ]);
  state = EditorState.create({ doc: schema.node("doc", null, [p]) });
  expect(projectText(state.doc).text).toBe("abcd");
  expect(projectedRange(state.doc, 0, 2)).toEqual({ from: 1, to: 3 });
  expect(() =>
    replaceMatches(state, [{ start: 0, end: 4 }], "fixed", "abcd"),
  ).toThrow(/tracked deletion/);
  expect(() =>
    proofreadingTransaction(state, "abcd", [
      { start: 0, end: 4, originalText: "abcd", replacement: "fixed" },
    ]),
  ).toThrow(/tracked deletion/);
  state = state.apply(
    proofreadingTransaction(state, "abcd", [
      { start: 0, end: 2, originalText: "ab", replacement: "AB" },
    ]),
  );
  expect(projectText(state.doc).text).toBe("ABcd");
  expect(documentChanges(state.doc)[0].ranges[0].text).toBe("deleted");
});
const initial = () => {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, schema.text("Original wording.")),
  ]);
  return EditorState.create({
    doc,
    plugins: [history()],
    selection: TextSelection.create(doc, 1),
  });
};
it("retains deleted text and both review views, then accepts or rejects with undo", () => {
  let state = initial();
  state = state.apply(
    trackInlineTransaction(state, state.tr.insertText("Changed", 1, 9), stamp),
  );
  expect(reviewDocument(state.doc, "final").textContent).toBe(
    "Changed wording.",
  );
  expect(reviewDocument(state.doc, "original").textContent).toBe(
    "Original wording.",
  );
  expect(documentChanges(state.doc)).toHaveLength(1);
  expect(documentChanges(state.doc)[0].ranges.map((r) => r.kind)).toEqual([
    "deletion",
    "insertion",
  ]);
  const rejected = state.apply(
    resolveChanges(state, new Set([stamp.id]), "reject"),
  );
  expect(rejected.doc.textContent).toBe("Original wording.");
  expect(documentChanges(rejected.doc)).toEqual([]);
  state = state.apply(resolveChanges(state, new Set([stamp.id]), "accept"));
  expect(state.doc.textContent).toBe("Changed wording.");
  undo(state, (tr) => {
    state = state.apply(tr);
  });
  expect(documentChanges(state.doc)).toHaveLength(1);
  undo(state, (tr) => {
    state = state.apply(tr);
  });
  expect(state.doc.textContent).toBe("Original wording.");
  redo(state, (tr) => {
    state = state.apply(tr);
  });
  expect(documentChanges(state.doc)).toHaveLength(1);
});
it("retains formatting in deletions and independently resolves another author's insertion", () => {
  let state = initial();
  state = state.apply(state.tr.addMark(1, 9, schema.marks.strong.create()));
  state = state.apply(
    trackInlineTransaction(state, state.tr.insertText("new ", 1), stamp),
  );
  state = state.apply(
    trackInlineTransaction(state, state.tr.delete(1, 5), {
      ...stamp,
      id: "change_two",
      author: "Second",
    }),
  );
  expect(documentChanges(state.doc)).toHaveLength(2);
  expect(reviewDocument(state.doc, "final").textContent).toBe(
    "Original wording.",
  );
  state = state.apply(resolveChanges(state, new Set(["change_two"]), "reject"));
  expect(reviewDocument(state.doc, "final").textContent).toBe(
    "new Original wording.",
  );
  state = state.apply(
    trackInlineTransaction(state, state.tr.delete(5, 13), {
      ...stamp,
      id: "change_three",
    }),
  );
  expect(
    state.doc.firstChild!.child(1).marks.some((m) => m.type.name === "strong"),
  ).toBe(true);
});
it("cancels the author's own inserted text and tracks multiple replacements in one group", () => {
  let state = initial();
  state = state.apply(
    trackInlineTransaction(state, state.tr.insertText("new ", 1), stamp),
  );
  state = state.apply(
    trackInlineTransaction(state, state.tr.delete(1, 5), {
      ...stamp,
      id: "change_two",
    }),
  );
  expect(documentChanges(state.doc)).toHaveLength(0);
  const transaction = state.tr
    .insertText("text", 10, 17)
    .insertText("New", 1, 9);
  state = state.apply(trackInlineTransaction(state, transaction, stamp));
  expect(reviewDocument(state.doc, "final").textContent).toBe("New text.");
  expect(reviewDocument(state.doc, "original").textContent).toBe(
    "Original wording.",
  );
  state = state.apply(resolveChanges(state, new Set([stamp.id]), "reject"));
  expect(state.doc.textContent).toBe("Original wording.");
});
it("refuses unsupported structure atomically and leaves history operations untracked", () => {
  let state = initial();
  const tr = state.tr.split(4),
    before = tr.doc;
  expect(() => trackInlineTransaction(state, tr, stamp)).toThrow(/structural/);
  expect(tr.doc).toBe(before);
  state = state.apply(
    trackInlineTransaction(state, state.tr.insertText("new ", 1), stamp),
  );
  undo(state, (tr) => {
    state = state.apply(trackInlineTransaction(state, tr, stamp));
  });
  expect(state.doc.textContent).toBe("Original wording.");
});
