import { it, expect } from "vitest";
import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { schema as base } from "./Editor";
import { revisionMarkSpec } from "./trackedChanges";
import { revisionFormatSpec } from "./trackedFormatting";
import {
  revisionBreakSpec,
  reviewParagraphDocument,
} from "./trackedParagraphs";
import {
  reviewChanges,
  resolveReviewChanges,
  trackReviewTransaction,
  reviewedDocument,
  editReviewedDocument,
} from "./trackedReview";
const schema = new Schema({
  nodes: base.spec.nodes.addBefore("text", "revision_break", revisionBreakSpec),
  marks: base.spec.marks.append({
    revision_insertion: revisionMarkSpec("insertion"),
    revision_deletion: revisionMarkSpec("deletion"),
    revision_format: revisionFormatSpec,
  }),
});

it("editing with tracking off retains unrelated pending wording and formatting", () => {
  let state = EditorState.create({
    doc: schema.node("doc", null, [
      schema.node(
        "paragraph",
        { align: "left", spaceAfter: 0 },
        schema.text("Old wording."),
      ),
    ]),
    plugins: [history()],
  });
  state = state.apply(
    trackReviewTransaction(state, state.tr.insertText("New", 1, 4), stamp),
  );
  const reviewed = state.doc;
  state = state.apply(
    editReviewedDocument(
      state,
      state.tr.insertText("!", state.doc.content.size - 1),
    ),
  );
  expect(reviewChanges(state.doc).map((c) => c.id)).toEqual([stamp.id]);
  expect(reviewedDocument(state.doc, "original").textContent).toBe(
    "Old wording.!",
  );
  expect(reviewedDocument(state.doc, "final").textContent).toBe(
    "New wording.!",
  );
  undo(state, (tr) => {
    state = state.apply(tr);
  });
  expect(state.doc.eq(reviewed)).toBe(true);
  state = state.apply(
    trackReviewTransaction(
      state,
      state.tr.setNodeMarkup(0, undefined, {
        ...state.doc.firstChild!.attrs,
        align: "center",
      }),
      { ...stamp, id: "alignment" },
    ),
  );
  state = state.apply(
    editReviewedDocument(
      state,
      state.tr.setNodeMarkup(0, undefined, {
        ...state.doc.firstChild!.attrs,
        spaceAfter: 12,
      }),
    ),
  );
  expect(
    reviewChanges(state.doc)
      .map((c) => c.id)
      .sort(),
  ).toEqual(["alignment", stamp.id]);
  state = state.apply(
    resolveReviewChanges(state, new Set(["alignment"]), "reject"),
  );
  expect(state.doc.firstChild!.attrs).toMatchObject({
    align: "left",
    spaceAfter: 12,
    revisionProperties: null,
  });
  expect(reviewChanges(state.doc).map((c) => c.id)).toEqual([stamp.id]);
});

it("retains insertion evidence through clear formatting and resolves text and appearance together", () => {
  let state = EditorState.create({
    doc: schema.node("doc", null, [
      schema.node("paragraph", null, schema.text("Old")),
    ]),
    plugins: [history()],
  });
  state = state.apply(
    trackReviewTransaction(state, state.tr.insertText(" new", 4), stamp),
  );
  state = state.apply(
    trackReviewTransaction(
      state,
      state.tr.addMark(1, 8, schema.marks.strong.create()),
      { ...stamp, id: "format", author: "Second" },
    ),
  );
  state = state.apply(
    trackReviewTransaction(state, state.tr.removeMark(1, 8), {
      ...stamp,
      id: "clear",
      author: "Third",
    }),
  );
  expect(reviewedDocument(state.doc, "original").textContent).toBe("Old");
  expect(
    reviewChanges(state.doc)
      .map((c) => c.id)
      .sort(),
  ).toEqual(["clear", "first", "format"]);
  state = state.apply(
    resolveReviewChanges(
      state,
      new Set(["clear", "first", "format"]),
      "reject",
    ),
  );
  expect(state.doc.textContent).toBe("Old");
  expect(state.doc.firstChild!.firstChild!.marks).toEqual([]);
  undo(state, (tr) => {
    state = state.apply(tr);
  });
  expect(reviewChanges(state.doc)).toHaveLength(3);
});
const stamp = {
  id: "first",
  author: "First reviewer",
  date: "2026-10-29T01:00:00Z",
};
it("rejects one author's text and paragraph changes together in a single undo event", () => {
  let state = EditorState.create({
    doc: schema.node("doc", null, [
      schema.node("paragraph", null, schema.text("One two")),
    ]),
    plugins: [history()],
  });
  state = state.apply(trackReviewTransaction(state, state.tr.split(5), stamp));
  state = state.apply(
    trackReviewTransaction(state, state.tr.insertText("new ", 1), {
      ...stamp,
      id: "second",
    }),
  );
  expect(reviewChanges(state.doc)).toHaveLength(2);
  const ids = new Set(
    reviewChanges(state.doc)
      .filter((c) => c.author === stamp.author)
      .map((c) => c.id),
  );
  state = state.apply(resolveReviewChanges(state, ids, "reject"));
  expect(state.doc.childCount).toBe(1);
  expect(state.doc.textContent).toBe("One two");
  expect(reviewChanges(state.doc)).toHaveLength(0);
  undo(state, (tr) => {
    state = state.apply(tr);
  });
  expect(reviewChanges(state.doc)).toHaveLength(2);
  expect(reviewParagraphDocument(state.doc, "original").textContent).toBe(
    "One two",
  );
});
it("accepting a paragraph change keeps later text edits reviewable", () => {
  let state = EditorState.create({
    doc: schema.node("doc", null, [
      schema.node("paragraph", null, schema.text("One two")),
    ]),
  });
  state = state.apply(trackReviewTransaction(state, state.tr.split(5), stamp));
  state = state.apply(
    trackReviewTransaction(state, state.tr.insertText("new ", 1), {
      ...stamp,
      id: "second",
      author: "Second reviewer",
    }),
  );
  state = state.apply(
    resolveReviewChanges(state, new Set([stamp.id]), "accept"),
  );
  expect(state.doc.childCount).toBe(2);
  expect(reviewChanges(state.doc).map((change) => change.id)).toEqual([
    "second",
  ]);
  state = state.apply(
    resolveReviewChanges(state, new Set(["second"]), "reject"),
  );
  expect(state.doc.childCount).toBe(2);
  expect(state.doc.textContent).toBe("One two");
});

it("tracks Enter followed by a next-paragraph style and later formatting inside inserted text", () => {
  let state = EditorState.create({
    doc: schema.node("doc", null, [
      schema.node(
        "heading",
        { level: 2, blockId: "heading" },
        schema.text("Title rest"),
      ),
    ]),
    plugins: [history()],
  });
  const original = state.doc;
  const split = state.tr.split(7).setNodeMarkup(8, schema.nodes.paragraph, {
    blockId: "body",
    align: "left",
  });
  state = state.apply(trackReviewTransaction(state, split, stamp));
  expect(state.doc.childCount).toBe(2);
  expect(reviewedDocument(state.doc, "original").eq(original)).toBe(true);
  state = state.apply(
    resolveReviewChanges(state, new Set([stamp.id]), "reject"),
  );
  expect(state.doc.eq(original)).toBe(true);
  const input = state.tr
    .insertText("Added ", 1)
    .addMark(2, 5, schema.marks.strong.create());
  state = state.apply(
    trackReviewTransaction(state, input, { ...stamp, id: "insert-format" }),
  );
  expect(reviewedDocument(state.doc, "final").textContent).toBe(
    "Added Title rest",
  );
  const bold: string[] = [];
  state.doc.descendants((n) => {
    if (n.isText && n.marks.some((m) => m.type.name === "strong"))
      bold.push(n.text!);
  });
  expect(bold.join("")).toBe("dde");
  state = state.apply(
    resolveReviewChanges(state, new Set(["insert-format"]), "reject"),
  );
  expect(state.doc.eq(original)).toBe(true);
});
