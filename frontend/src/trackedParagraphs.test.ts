import { expect, it } from "vitest";
import { Schema } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { schema as editorSchema } from "./Editor";
import {
  revisionBreakSpec,
  trackParagraphTransaction,
  paragraphChanges,
  reviewParagraphDocument,
  resolveParagraphChanges,
} from "./trackedParagraphs";
const schema = new Schema({
  nodes: editorSchema.spec.nodes.addBefore(
    "text",
    "revision_break",
    revisionBreakSpec,
  ),
  marks: editorSchema.spec.marks,
});
const stamp = {
  id: "break_one",
  author: "Writer",
  date: "2026-10-29T01:00:00Z",
};
const stateFor = (nodes: any[]) => {
  const doc = schema.node("doc", null, nodes);
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, 4),
    plugins: [history()],
  });
};
it("records Enter as an inserted boundary and can reject it without losing text", () => {
  let state = stateFor([
    schema.node(
      "paragraph",
      { blockId: "first", align: "right" },
      schema.text("One two"),
    ),
  ]);
  state = state.apply(
    trackParagraphTransaction(state, state.tr.split(5), stamp)!,
  );
  expect(state.doc.childCount).toBe(2);
  expect(paragraphChanges(state.doc)).toHaveLength(1);
  expect(reviewParagraphDocument(state.doc, "original").childCount).toBe(1);
  expect(reviewParagraphDocument(state.doc, "original").textContent).toBe(
    "One two",
  );
  expect(reviewParagraphDocument(state.doc, "final").childCount).toBe(2);
  state = state.apply(
    resolveParagraphChanges(state, new Set([stamp.id]), "reject"),
  );
  expect(state.doc.childCount).toBe(1);
  expect(state.doc.textContent).toBe("One two");
  expect(state.doc.firstChild!.attrs.align).toBe("right");
  undo(state, (tr) => {
    state = state.apply(tr);
  });
  expect(paragraphChanges(state.doc)).toHaveLength(1);
});
it("records a joined paragraph and restores its distinct type, formatting and identity", () => {
  let state = stateFor([
    schema.node("paragraph", { blockId: "first" }, schema.text("One")),
    schema.node(
      "heading",
      { blockId: "second", level: 2, align: "center" },
      schema.text("Two"),
    ),
  ]);
  state = state.apply(
    trackParagraphTransaction(state, state.tr.join(5), stamp)!,
  );
  expect(state.doc.childCount).toBe(1);
  const original = reviewParagraphDocument(state.doc, "original");
  expect(original.childCount).toBe(2);
  expect(original.lastChild!.type.name).toBe("heading");
  state = state.apply(
    resolveParagraphChanges(state, new Set([stamp.id]), "reject"),
  );
  expect(state.doc.lastChild!.attrs).toMatchObject({
    blockId: "second",
    level: 2,
    align: "center",
  });
  expect(state.doc.lastChild!.textContent).toBe("Two");
});
it("cancels the author's own inserted boundary and flags separated endpoints", () => {
  let state = stateFor([
    schema.node("paragraph", { blockId: "first" }, schema.text("One two")),
  ]);
  state = state.apply(
    trackParagraphTransaction(state, state.tr.split(5), stamp)!,
  );
  const split = state;
  state = state.apply(
    trackParagraphTransaction(
      state,
      state.tr.join(state.doc.firstChild!.nodeSize),
      { ...stamp, id: "break_two" },
    )!,
  );
  expect(paragraphChanges(state.doc)).toHaveLength(0);
  expect(state.doc.textContent).toBe("One two");
  const moved = schema.node("doc", null, [
    split.doc.lastChild!,
    split.doc.firstChild!,
  ]);
  state = EditorState.create({ doc: moved });
  expect(() =>
    resolveParagraphChanges(state, new Set([stamp.id]), "reject"),
  ).toThrow(/moved apart/);
  expect(() => reviewParagraphDocument(state.doc, "original")).toThrow(
    /incomplete/,
  );
});
