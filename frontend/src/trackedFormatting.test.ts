import { it, expect } from "vitest";
import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { schema as base } from "./Editor";
import {
  revisionFormatSpec,
  trackFormattingTransaction,
  resolveFormattingChanges,
  formattingChanges,
  formatReviewDocument,
} from "./trackedFormatting";
const schema = new Schema({
  nodes: base.spec.nodes,
  marks: base.spec.marks.append({ revision_format: revisionFormatSpec }),
});
const first = { id: "first", author: "First", date: "2026-10-29T01:00:00Z" },
  second = { id: "second", author: "Second", date: "2026-10-29T02:00:00Z" };
const initial = () =>
  EditorState.create({
    doc: schema.node("doc", null, [
      schema.node("paragraph", null, schema.text("Text")),
    ]),
    plugins: [history()],
  });
const has = (state: EditorState, name: string) =>
  state.doc.firstChild!.firstChild!.marks.some((m) => m.type.name === name);
it("keeps independent authors' formatting edits and supports one undoable decision", () => {
  let state = initial();
  state = state.apply(
    trackFormattingTransaction(
      state,
      state.tr.addMark(1, 5, schema.marks.strong.create()),
      first,
    )!,
  );
  state = state.apply(
    trackFormattingTransaction(
      state,
      state.tr.addMark(1, 5, schema.marks.em.create()),
      second,
    )!,
  );
  expect(
    formatReviewDocument(state.doc, "original").firstChild!.firstChild!.marks,
  ).toEqual([]);
  state = state.apply(
    resolveFormattingChanges(state, new Set([second.id]), "accept"),
  );
  expect(
    formatReviewDocument(
      state.doc,
      "original",
    ).firstChild!.firstChild!.marks.map((m) => m.type.name),
  ).toEqual(["em"]);
  state = state.apply(
    resolveFormattingChanges(state, new Set([first.id]), "reject"),
  );
  expect(has(state, "strong")).toBe(false);
  expect(has(state, "em")).toBe(true);
  expect(formattingChanges(state.doc)).toEqual([]);
  undo(state, (tr) => {
    state = state.apply(tr);
  });
  expect(formattingChanges(state.doc)).toHaveLength(1);
});
it("an accepted later override wins when an earlier format change is rejected", () => {
  let state = initial();
  state = state.apply(
    trackFormattingTransaction(
      state,
      state.tr.addMark(1, 5, schema.marks.strong.create()),
      first,
    )!,
  );
  state = state.apply(
    trackFormattingTransaction(
      state,
      state.tr.removeMark(1, 5, schema.marks.strong),
      second,
    )!,
  );
  state = state.apply(
    resolveFormattingChanges(state, new Set([second.id]), "accept"),
  );
  expect(has(state, "strong")).toBe(false);
  state = state.apply(
    resolveFormattingChanges(state, new Set([first.id]), "reject"),
  );
  expect(has(state, "strong")).toBe(false);
  expect(formattingChanges(state.doc)).toEqual([]);
});
it("font-size and family revisions do not accidentally accept each other", () => {
  let state = initial();
  state = state.apply(
    state.tr.addMark(
      1,
      5,
      schema.marks.text_style.create({ fontFamily: "Cambria", fontSize: 12 }),
    ),
  );
  state = state.apply(
    trackFormattingTransaction(
      state,
      state.tr.addMark(
        1,
        5,
        schema.marks.text_style.create({ fontFamily: "Arial", fontSize: 12 }),
      ),
      first,
    )!,
  );
  state = state.apply(
    trackFormattingTransaction(
      state,
      state.tr.addMark(
        1,
        5,
        schema.marks.text_style.create({ fontFamily: "Arial", fontSize: 18 }),
      ),
      second,
    )!,
  );
  state = state.apply(
    resolveFormattingChanges(state, new Set([second.id]), "accept"),
  );
  const original = formatReviewDocument(
    state.doc,
    "original",
  ).firstChild!.firstChild!.marks.find((m) => m.type.name === "text_style")!;
  expect(original.attrs).toMatchObject({ fontFamily: "Cambria", fontSize: 18 });
  state = state.apply(
    resolveFormattingChanges(state, new Set([first.id]), "reject"),
  );
  expect(
    state.doc.firstChild!.firstChild!.marks.find(
      (m) => m.type.name === "text_style",
    )!.attrs,
  ).toMatchObject({ fontFamily: "Cambria", fontSize: 18 });
});
it("clear-formatting preserves revision records and split runs keep their own baselines", () => {
  let state = initial();
  state = state.apply(state.tr.addMark(1, 3, schema.marks.strong.create()));
  state = state.apply(
    trackFormattingTransaction(
      state,
      state.tr.addMark(1, 5, schema.marks.em.create()),
      first,
    )!,
  );
  state = state.apply(
    trackFormattingTransaction(state, state.tr.removeMark(1, 5), second)!,
  );
  expect(formattingChanges(state.doc)).toHaveLength(2);
  state = state.apply(
    resolveFormattingChanges(state, new Set([first.id, second.id]), "reject"),
  );
  expect(state.doc.firstChild!.childCount).toBe(2);
  expect(state.doc.firstChild!.child(0).marks.map((m) => m.type.name)).toEqual([
    "strong",
  ]);
  expect(state.doc.firstChild!.child(1).marks).toEqual([]);
});
