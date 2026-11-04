// @vitest-environment jsdom
import { it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import { history, undo, redo } from "prosemirror-history";
import { DOMSerializer } from "prosemirror-model";
import { schema, parseEditorDocument } from "./Editor";
import { documentUnits, moveArrangementUnit } from "./arrangementUnits";
import {
  trackReviewTransaction,
  resolveReviewChanges,
  reviewChanges,
  reviewedDocument,
  editReviewedDocument,
} from "./trackedReview";
import { validateReviewMoves } from "./trackedMoves";
import { projectText } from "./textProjection";
import { speechText } from "./speechText";
import { clipboardSlice } from "./pasteText";
import { validateReviewMarkup } from "./reviewMarkup";
import { documentText, textLanguageSpans } from "./textProjection";
import { moveOutlineSection } from "./documentOutline";
import { headingLabels } from "./headingNumbering";
import { blockIdentities, identifiedDocument } from "./blockIdentities";

import { formFieldGuards } from "./formFields";

const stamp = {
  id: "movement",
  author: "Reviewer",
  date: "2026-11-03T00:00:00Z",
};
const p = (text: string) => schema.node("paragraph", null, schema.text(text));
it.each([
  [false, "inline_image"],
  [true, "inline_image"],
  [false, "equation"],
  [true, "equation"],
  [false, "shape"],
  [true, "shape"],
  [false, "form_field"],
  [true, "form_field"],
  [false, "text_box"],
  [true, "text_box"],
] as const)(
  "keeps object identity through a tracked paragraph move and its decisions (backwards=%s, %s)",
  (backwards, kind) => {
    const picture =
      kind === "text_box" ? schema.node("text_box",{blockId:"figure",width:180,fill:"#c9d8e8"},schema.text("Box value.",[schema.marks.strong.create()])) : kind === "form_field" ? schema.node("form_field",{blockId:"figure",kind:"rich",label:"Locked value",tag:"moved-value",lockContent:true,lockDelete:true},schema.text("Field value.",[schema.marks.strong.create()])) : kind === "shape" ? schema.node("shape",{blockId:"figure",kind:"arrow",alt:"Direction",width:120,fill:"#c9d8e8"}) : kind === "equation"
        ? schema.node(
            "equation",
            {
              blockId: "figure",
              mathML:
                '<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>',
              latex: "",
            },
            schema.text("fraction a over b end fraction"),
          )
        : schema.node("inline_image", {
            blockId: "figure",
            src: "/api/projects/test/assets/picture",
            assetId: "picture",
            alt: "Illustration",
            width: 120,
            crop: { left: 10, right: 0, top: 0, bottom: 0 },
          });
    const rich = schema.node(
      "paragraph",
      { blockId: "illustrated", align: "center" },
      [schema.text("Before "), picture, schema.text(" after.")],
    );
    const original = identifiedDocument(
      schema.node(
        "doc",
        null,
        backwards ? [p("Middle."), rich] : [rich, p("Middle.")],
      ),
    );
    let state = EditorState.create({
      doc: original,
      plugins: [history(), blockIdentities(), formFieldGuards()],
    });
    const units = documentUnits(state.doc).filter(
      (u) => u.kind === "paragraph",
    );
    const operation = moveArrangementUnit(
      state,
      units[backwards ? 1 : 0],
      backwards ? 0 : state.doc.content.size,
    )!;
    state = state.applyTransaction(
      trackReviewTransaction(state, operation.tr, stamp),
    ).state;
    validateReviewMoves(state.doc);
    const imageIds: string[] = [];
    state.doc.descendants((n) => {
      if (n.type.name === kind) imageIds.push(n.attrs.blockId);
    });
    expect(new Set(imageIds).size).toBe(2);
    state.doc.descendants((node, pos) => {
      if (node.type.name === kind)
        expect(() =>
          editReviewedDocument(
            state,
            state.tr.setNodeAttribute(
              pos,
              kind === "equation" ? "latex" : kind === "form_field" ? "label" : "width",
              kind === "equation" || kind === "form_field" ? "changed" : 240,
            ),
          ),
        ).toThrow(/Accept or reject/);
    });
    for (const view of ["original", "final"] as const)
      expect(
        reviewedDocument(state.doc, view).eq(
          view === "original" ? original : operation.tr.doc,
        ),
      ).toBe(true);
    expect(speechText(state.doc).text).toBe(speechText(operation.tr.doc).text);
    for (const decision of ["accept", "reject"] as const) {
      let changed = state.applyTransaction(
        resolveReviewChanges(state, new Set([stamp.id]), decision),
      ).state;
      expect(
        changed.doc.eq(decision === "accept" ? operation.tr.doc : original),
      ).toBe(true);
      undo(changed, (tr) => {
        changed = changed.apply(tr);
      });
      expect(changed.doc.eq(state.doc)).toBe(true);
    }
    expect(
      parseEditorDocument(state.doc.toJSON()).document?.eq(state.doc),
    ).toBe(true);
    const html = document.createElement("div");
    html.append(
      DOMSerializer.fromSchema(schema).serializeFragment(state.doc.content),
    );
    if (kind === "inline_image") expect(()=>clipboardSlice(schema,"",html.innerHTML,"source")).toThrow(/could not be collected/);
    const copied = identifiedDocument(schema.node(
      "doc",
      null,
      clipboardSlice(schema, "", html.innerHTML, "source", undefined, undefined, new Map([["/api/projects/test/assets/picture","picture"]])).content,
    ));
    validateReviewMoves(copied);
    const targets = ["original", "final"].map((view) => {
      const ids: string[] = [];
      reviewedDocument(copied, view as "original" | "final").descendants(
        (n) => {
          if (n.type.name === kind) ids.push(n.attrs.blockId);
        },
      );
      return ids;
    });
    expect(targets[0]).toEqual(targets[1]);
    expect(targets[0][0]).toBeTruthy();
    expect(targets[0][0]).not.toBe("figure");
    const broken = state.doc.toJSON();
    const moved = broken.content.find(
      (n: any) => n.attrs.revisionMove?.kind === "insertion",
    );
    moved.content.find((n: any) => n.type === kind).attrs[
      kind === "equation" ? "latex" : kind === "form_field" ? "label" : kind === "text_box" ? "fill" : "alt"
    ] = "Changed";
    expect(() => validateReviewMoves(schema.nodeFromJSON(broken))).toThrow(
      /same contents/,
    );
  },
);
const initial = () =>
  EditorState.create({
    doc: schema.node("doc", null, [
      p("Alpha sentence. Beta sentence. Gamma sentence."),
      p("Delta sentence. Epsilon sentence."),
    ]),
    plugins: [history()],
  });
it.each([
  [0, 2],
  [2, 0],
  [0, 4],
  [4, 1],
])(
  "tracks a sentence move %s to %s without changing original/final wording",
  (from, to) => {
    let state = initial();
    const original = state.doc;
    const units = documentUnits(state.doc).filter((u) => u.kind === "sentence");
    const move = moveArrangementUnit(state, units[from], units[to].from)!;
    const final = move.tr.doc;
    state = state.apply(trackReviewTransaction(state, move.tr, stamp));
    validateReviewMoves(state.doc);
    expect(reviewChanges(state.doc)).toHaveLength(1);
    expect(reviewChanges(state.doc)[0].move).toBe(true);
    expect(reviewedDocument(state.doc, "original").eq(original)).toBe(true);
    expect(reviewedDocument(state.doc, "final").eq(final)).toBe(true);
    expect(speechText(state.doc).text).toBe(projectText(final).text);
    for (const decision of ["accept", "reject"] as const) {
      let reviewed = EditorState.create({
        doc: state.doc,
        plugins: [history()],
      });
      reviewed = reviewed.apply(
        resolveReviewChanges(reviewed, new Set([stamp.id]), decision),
      );
      expect(reviewed.doc.eq(decision === "accept" ? final : original)).toBe(
        true,
      );
      undo(reviewed, (tr) => (reviewed = reviewed.apply(tr)));
      expect(reviewed.doc.eq(state.doc)).toBe(true);
    }
    const moved = state.doc;
    undo(state, (tr) => (state = state.apply(tr)));
    expect(state.doc.eq(original)).toBe(true);
    redo(state, (tr) => (state = state.apply(tr)));
    expect(state.doc.eq(moved)).toBe(true);
    expect(parseEditorDocument(moved.toJSON()).document?.eq(moved)).toBe(true);
  },
);
it.each([
  [0, 2],
  [2, 0],
])(
  "tracks complete paragraph moves with identity, formatting and exact projections %s to %s",
  (from, to) => {
    const nodes = [
      "First paragraph.",
      "Second paragraph.",
      "Third paragraph.",
    ].map((text, i) =>
      schema.node(
        i === 0 ? "heading" : "paragraph",
        { blockId: `block_${i}`, align: "right", fontSize: 14 },
        schema.text(text, [schema.marks.strong.create()]),
      ),
    );
    let state = EditorState.create({
      doc: schema.node("doc", null, nodes),
      plugins: [history()],
    });
    const original = state.doc;
    const units = documentUnits(state.doc).filter(
      (u) => u.kind === "paragraph",
    );
    const operation = moveArrangementUnit(
      state,
      units[from],
      from < to ? units[to].to : units[to].from,
    )!;
    state = state.apply(trackReviewTransaction(state, operation.tr, stamp));
    validateReviewMoves(state.doc);
    expect(reviewChanges(state.doc)).toHaveLength(1);
    expect(reviewedDocument(state.doc, "original").eq(original)).toBe(true);
    const final = reviewedDocument(state.doc, "final");
    expect(final.eq(operation.tr.doc)).toBe(true);
    expect(projectText(state.doc).text).toBe(projectText(final).text);
    expect(documentText(state.doc.toJSON())).toBe(projectText(final).text);
    expect(textLanguageSpans(state.doc.toJSON(), new Map(), "en")).toEqual([
      { start: 0, end: projectText(final).text.length, language: "en" },
    ]);
    for (const decision of ["accept", "reject"] as const)
      expect(
        state
          .apply(resolveReviewChanges(state, new Set([stamp.id]), decision))
          .doc.eq(decision === "accept" ? final : original),
      ).toBe(true);
    const copy = document.createElement("div");
    copy.append(
      DOMSerializer.fromSchema(schema).serializeFragment(state.doc.content),
    );
    const copied = schema.node(
      "doc",
      null,
      clipboardSlice(schema, "", copy.innerHTML, "source").content,
    );
    validateReviewMoves(copied);
    const pasteTarget = EditorState.create({
      doc: schema.node("doc", null, p("Before and after.")),
    });
    const pasted = pasteTarget.tr.replaceSelection(
      clipboardSlice(schema, "", copy.innerHTML, "source"),
    ).doc;
    validateReviewMoves(pasted);
    const moved = reviewedDocument(copied, "final");
    expect(moved.child(from < to ? 2 : 0).attrs.blockId).not.toBe(
      nodes[from].attrs.blockId,
    );
    const pending = reviewChanges(state.doc)[0].ranges[0];
    expect(() =>
      editReviewedDocument(state, state.tr.insertText("x", pending.from + 2)),
    ).toThrow(/Accept or reject/);
    expect(() =>
      editReviewedDocument(
        state,
        state.tr.setNodeMarkup(pending.from, undefined, {
          ...state.doc.nodeAt(pending.from)!.attrs,
          align: "center",
        }),
      ),
    ).toThrow(/Accept or reject/);
    expect(
      parseEditorDocument(state.doc.toJSON()).document?.eq(state.doc),
    ).toBe(true);
    undo(state, (tr) => (state = state.apply(tr)));
    expect(state.doc.eq(original)).toBe(true);
  },
);
it("tracks an outline section as one ordered move with one accept/reject decision", () => {
  const h = (text: string, id: string) =>
    schema.node(
      "heading",
      { level: 1, blockId: id, headingNumbered: true },
      schema.text(text),
    );
  const original = schema.node("doc", null, [
    h("First", "a"),
    p("First body."),
    h("Second", "b"),
    p("Second body."),
    h("Third", "c"),
    p("Third body."),
  ]);
  const state = EditorState.create({ doc: original, plugins: [history()] });
  const operation = moveOutlineSection(state, "a", "c", true)!;
  const moved = state.apply(trackReviewTransaction(state, operation, stamp));
  validateReviewMoves(moved.doc);
  expect(reviewChanges(moved.doc)).toHaveLength(1);
  expect(reviewChanges(moved.doc)[0].ranges).toHaveLength(4);
  expect(headingLabels(moved.doc).map((x) => x.label)).toEqual(["1", "2", "3"]);
  expect(speechText(moved.doc, 0, undefined, true).text).toBe(
    projectText(operation.doc).text,
  );
  for (const decision of ["accept", "reject"] as const)
    expect(
      moved
        .apply(resolveReviewChanges(moved, new Set([stamp.id]), decision))
        .doc.eq(decision === "accept" ? operation.doc : original),
    ).toBe(true);
  const partial = moved.tr.delete(0, moved.doc.child(0).nodeSize).doc;
  expect(() => validateReviewMoves(partial)).toThrow(/complete sides/);
  expect(() =>
    editReviewedDocument(
      moved,
      moved.tr.insert(moved.doc.child(0).nodeSize, p("interleaved")),
    ),
  ).toThrow(/Accept or reject/);
  expect(() =>
    editReviewedDocument(
      moved,
      moved.tr.setNodeAttribute(0, "align", "center"),
    ),
  ).toThrow(/Accept or reject/);
});
it("preserves appearance, paired rich copies and edits outside pending moves", () => {
  let state = initial();
  state = state.apply(state.tr.addMark(1, 6, schema.marks.strong.create()));
  const unit = documentUnits(state.doc).find((u) => u.kind === "sentence")!;
  state = state.apply(
    trackReviewTransaction(
      state,
      moveArrangementUnit(state, unit, state.doc.content.size - 1)!.tr,
      stamp,
    ),
  );
  const copy = document.createElement("div");
  copy.append(
    DOMSerializer.fromSchema(schema).serializeFragment(state.doc.content),
  );
  const slice = clipboardSlice(schema, "", copy.innerHTML, "source");
  validateReviewMoves(slice.content);
  const copied = schema.node("doc", null, slice.content),
    changes = reviewChanges(copied);
  expect(changes).toHaveLength(1);
  expect(changes[0].id).not.toBe(stamp.id);
  expect(changes[0].move).toBe(true);
  const moveText = changes[0].ranges.find((r) => r.kind === "insertion")!;
  expect(
    copied.nodeAt(moveText.from)?.marks.some((m) => m.type.name === "strong"),
  ).toBe(false); // leading space is independently styled
  const final = reviewedDocument(copied, "final");
  expect(final.rangeHasMark(0, final.content.size, schema.marks.strong)).toBe(
    true,
  );
  const range = reviewChanges(state.doc)[0].ranges.find(
    (r) => r.kind === "insertion",
  )!;
  expect(() =>
    editReviewedDocument(state, state.tr.insertText("x", range.from + 1)),
  ).toThrow(/Accept or reject/);
  const outside = state.apply(
    editReviewedDocument(
      state,
      state.tr.insertText("Unrelated. ", state.doc.child(0).nodeSize + 1),
    ),
  );
  expect(reviewChanges(outside.doc)[0].id).toBe(stamp.id);
  validateReviewMoves(outside.doc);
  const removed = reviewChanges(state.doc)[0].ranges.filter(
    (r) => r.kind === "deletion",
  );
  const broken = state.tr.delete(
    Math.min(...removed.map((r) => r.from)),
    Math.max(...removed.map((r) => r.to)),
  ).doc;
  expect(() => validateReviewMoves(broken)).toThrow();
  const insertion = reviewChanges(state.doc)[0].ranges.filter(
    (r) => r.kind === "insertion",
  );
  const partial = document.createElement("div");
  partial.append(
    DOMSerializer.fromSchema(schema).serializeFragment(
      state.doc.slice(
        Math.min(...insertion.map((r) => r.from)),
        Math.max(...insertion.map((r) => r.to)),
      ).content,
    ),
  );
  expect(() => clipboardSlice(schema, "", partial.innerHTML, "source")).toThrow(
    /both sides/,
  );
  for (const html of [
    '<span data-revision-move="true">bad</span>',
    '<span data-revision-insertion="id" data-revision-move="false">bad</span>',
  ]) {
    const invalid = document.createElement("div");
    invalid.innerHTML = html;
    expect(() => validateReviewMarkup(invalid)).toThrow(/metadata/);
  }
  const changed = state.tr.insertText(
    "changed",
    range.from + 1,
    range.from + 2,
  ).doc;
  expect(() => validateReviewMoves(changed)).toThrow();
});
