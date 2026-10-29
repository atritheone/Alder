import { it, expect } from "vitest";
import { AllSelection, EditorState, TextSelection } from "prosemirror-state";
import { Fragment, Slice } from "prosemirror-model";
import { history, undo } from "prosemirror-history";
import { schema } from "./Editor";
import {
  trackReviewTransaction,
  reviewedDocument,
  resolveReviewChanges,
} from "./trackedReview";
import { projectText } from "./textProjection";
const stamp = { id: "range", author: "Writer", date: "2026-10-29T05:00:00Z" };
const paragraph = (text: string, attrs: Record<string, unknown> = {}) =>
  schema.nodes.paragraph.create(attrs, text ? schema.text(text) : undefined);
function state() {
  return EditorState.create({
    doc: schema.nodes.doc.create(null, [
      paragraph("AAABBB", { blockId: "left" }),
      schema.nodes.heading.create(
        { level: 2, align: "center", blockId: "right" },
        schema.text("CCCDDD"),
      ),
    ]),
    plugins: [history()],
  });
}
const text = (state: EditorState, view: "final" | "original") =>
  projectText(reviewedDocument(state.doc, view)).text;
it("tracks a replacement crossing differently formatted paragraphs and rejects it in one undoable decision", () => {
  let current = state();
  const original = current.doc;
  const tr = current.tr.insertText("X", 4, 12);
  current = current.apply(trackReviewTransaction(current, tr, stamp));
  expect(text(current, "final")).toBe("AAAXDDD");
  expect(text(current, "original")).toBe("AAABBB\nCCCDDD");
  expect(
    reviewedDocument(current.doc, "original").child(1).attrs,
  ).toMatchObject({ level: 2, align: "center", blockId: "right" });
  current = current.apply(
    resolveReviewChanges(current, new Set([stamp.id]), "reject"),
  );
  expect(current.doc.eq(original)).toBe(true);
  undo(current, (tr) => {
    current = current.apply(tr);
  });
  expect(text(current, "final")).toBe("AAAXDDD");
});
it("multiline paste retains separate deleted and inserted paragraph marks", () => {
  let current = state();
  const original = current.doc;
  const slice = new Slice(
    Fragment.fromArray([paragraph("X"), paragraph("Y"), paragraph("Z")]),
    1,
    1,
  );
  current = current.apply(
    trackReviewTransaction(
      current,
      current.tr.replace(4, 12, slice).setMeta("uiEvent", "paste"),
      stamp,
    ),
  );
  expect(text(current, "final")).toBe("AAAX\nY\nZDDD");
  expect(text(current, "original")).toBe("AAABBB\nCCCDDD");
  const accepted = current.apply(
    resolveReviewChanges(current, new Set([stamp.id]), "accept"),
  );
  expect(projectText(accepted.doc).text).toBe("AAAX\nY\nZDDD");
  current = current.apply(
    resolveReviewChanges(current, new Set([stamp.id]), "reject"),
  );
  expect(current.doc.eq(original)).toBe(true);
});

it("whole-document replacement retains the original first heading's properties", () => {
  let current = EditorState.create({
    doc: schema.node("doc", null, [
      schema.node(
        "heading",
        { level: 3, align: "center", blockId: "first-heading" },
        schema.text("Title"),
      ),
      paragraph("Body"),
    ]),
  });
  const original = current.doc;
  const replacement = current.tr
    .setSelection(new AllSelection(current.doc))
    .replaceSelectionWith(paragraph("Replacement"));
  current = current.apply(trackReviewTransaction(current, replacement, stamp));
  expect(reviewedDocument(current.doc, "final").firstChild!.type.name).toBe(
    "paragraph",
  );
  expect(reviewedDocument(current.doc, "original").eq(original)).toBe(true);
  current = current.apply(
    resolveReviewChanges(current, new Set([stamp.id]), "reject"),
  );
  expect(current.doc.eq(original)).toBe(true);
});
it("tracks multiline insertion inside one paragraph without inventing original breaks", () => {
  let current = state();
  const original = current.doc;
  const slice = new Slice(
    Fragment.fromArray([paragraph("X"), paragraph("Y")]),
    1,
    1,
  );
  current = current.apply(
    trackReviewTransaction(current, current.tr.replace(4, 4, slice), stamp),
  );
  expect(text(current, "final")).toBe("AAAX\nYBBB\nCCCDDD");
  expect(text(current, "original")).toBe("AAABBB\nCCCDDD");
  current = current.apply(
    resolveReviewChanges(current, new Set([stamp.id]), "reject"),
  );
  expect(current.doc.eq(original)).toBe(true);
});
it("tracks cross-paragraph deletion and refuses to destroy annotation objects", () => {
  let current = state();
  const original = current.doc;
  current = current.apply(
    trackReviewTransaction(current, current.tr.delete(4, 12), stamp),
  );
  expect(text(current, "final")).toBe("AAADDD");
  current = current.apply(
    resolveReviewChanges(current, new Set([stamp.id]), "reject"),
  );
  expect(current.doc.eq(original)).toBe(true);
  current = current.apply(
    trackReviewTransaction(current, current.tr.split(4), stamp),
  );
  const before = current.doc;
  expect(() =>
    trackReviewTransaction(current, current.tr.delete(2, 12), stamp),
  ).toThrow(/pending paragraph/);
  expect(current.doc).toBe(before);
});

it("Select All replacement restores all original paragraphs and styles on rejection", () => {
  let current = state();
  const original = current.doc;
  const replacement = current.tr
    .setSelection(new AllSelection(current.doc))
    .replaceSelection(
      new Slice(
        Fragment.fromArray([paragraph("Entirely"), paragraph("new")]),
        0,
        0,
      ),
    );
  current = current.apply(trackReviewTransaction(current, replacement, stamp));
  expect(text(current, "final")).toBe("Entirely\nnew");
  expect(reviewedDocument(current.doc, "original").eq(original)).toBe(true);
  current = current.apply(
    resolveReviewChanges(current, new Set([stamp.id]), "reject"),
  );
  expect(current.doc.eq(original)).toBe(true);
  const deletion = current.tr
    .setSelection(new AllSelection(current.doc))
    .deleteSelection();
  current = current.apply(
    trackReviewTransaction(current, deletion, { ...stamp, id: "delete-all" }),
  );
  expect(text(current, "final")).toBe("");
  current = current.apply(
    resolveReviewChanges(current, new Set(["delete-all"]), "reject"),
  );
  expect(current.doc.eq(original)).toBe(true);
});
