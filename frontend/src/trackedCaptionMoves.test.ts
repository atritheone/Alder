// @vitest-environment jsdom
import { it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import { history, undo, redo } from "prosemirror-history";
import { schema } from "./Editor";
import { blockIdentities, identifiedDocument } from "./blockIdentities";
import { captionAnchors } from "./captionAnchors";
import { documentUnits, moveArrangementUnit } from "./arrangementUnits";
import { trackReviewTransaction, reviewedDocument, resolveReviewChanges } from "./trackedReview";
import { validateReviewMoves } from "./trackedMoves";
import { DOMSerializer } from "prosemirror-model";
import { clipboardSlice } from "./pasteText";

const stamp = { id: "caption_move", author: "Reviewer", date: "" };
function fixture(above: boolean, backwards: boolean) {
  const picture = schema.node("paragraph", { blockId: "illustrated" }, [schema.text("Illustration. "), schema.node("inline_image", { blockId: "picture", src: "/api/projects/test/assets/picture", assetId: "picture", alt: "Illustration", width: 96 })]);
  const caption = schema.node("paragraph", { blockId: "caption", captionLabel: "Figure", captionTargetId: "picture" }, [schema.text("Figure "), schema.node("sequence", { blockId: "number", sequenceName: "Figure" }, schema.text("1")), schema.text(": Caption.")]);
  const body = schema.node("paragraph", { blockId: "body" }, schema.text("Other paragraph."));
  const pair = above ? [caption, picture] : [picture, caption];
  return identifiedDocument(schema.node("doc", null, backwards ? [body, ...pair] : [...pair, body]));
}

it.each([[false, false], [false, true], [true, false], [true, true]])("reviews the attached caption with its picture (above=%s, backwards=%s)", (above, backwards) => {
  const doc = fixture(above, backwards);
  let state = EditorState.create({ doc, plugins: [history(), blockIdentities(), captionAnchors()] });
  const dispatch = (tr: any) => { state = state.applyTransaction(tr).state; };
  const unit = documentUnits(doc).find(unit => unit.kind === "paragraph" && doc.nodeAt(unit.from)?.attrs.blockId === "illustrated")!;
  const movement = moveArrangementUnit(state, unit, backwards ? 0 : doc.content.size)!;
  dispatch(trackReviewTransaction(state, movement.tr, stamp));
  validateReviewMoves(state.doc);
  const moved = state.doc;
  expect(moved.childCount).toBe(5);
  for (const kind of ["insertion", "deletion"]) {
    const side: any[] = [];
    moved.forEach(node => { if (node.attrs.revisionMove?.kind === kind) side.push(node); });
    expect(side).toHaveLength(2);
    expect(side.map(node => node.attrs.revisionMove.part)).toEqual([0, 1]);
    const picture = side.find(node => !node.attrs.captionLabel).child(1);
    expect(side.find(node => node.attrs.captionLabel).attrs.captionTargetId).toBe(picture.attrs.blockId);
  }
  expect(reviewedDocument(moved, "original").eq(doc)).toBe(true);
  const html = document.createElement("div");
  html.append(DOMSerializer.fromSchema(schema).serializeFragment(moved.content));
  const copied = identifiedDocument(schema.node("doc", null, clipboardSlice(schema, "", html.innerHTML, "source", undefined, undefined, new Map([["/api/projects/test/assets/picture", "picture"]])).content));
  validateReviewMoves(copied);
  for (const view of ["original", "final"] as const) {
    const result = reviewedDocument(copied, view), nodes = result.toJSON().content;
    const caption = nodes.find((node: any) => node.attrs.captionLabel);
    const picture = nodes.flatMap((node: any) => node.content).find((node: any) => node.type === "inline_image");
    expect(caption.attrs.captionTargetId).toBe(picture.attrs.blockId);
    expect(picture.attrs.blockId).not.toBe("picture");
  }
  for (const decision of ["accept", "reject"] as const) {
    const current = EditorState.create({ doc: moved, plugins: [blockIdentities(), captionAnchors()] });
    const result = current.applyTransaction(resolveReviewChanges(current, new Set([stamp.id]), decision)).state.doc;
    expect(result.eq(reviewedDocument(moved, decision === "accept" ? "final" : "original"))).toBe(true);
    const json = result.toJSON();
    expect(json.content.find((node: any) => node.attrs.captionLabel).attrs.captionTargetId).toBe("picture");
    expect(json.content.map((node: any) => node.attrs.blockId)).toEqual(decision === "reject" ? doc.toJSON().content.map((node: any) => node.attrs.blockId) : backwards ? (above ? ["caption", "illustrated", "body"] : ["illustrated", "caption", "body"]) : (above ? ["body", "caption", "illustrated"] : ["body", "illustrated", "caption"]));
  }
  undo(state, dispatch);expect(state.doc.eq(doc)).toBe(true);
  redo(state, dispatch);expect(state.doc.eq(moved)).toBe(true);
});

it("leaves the picture and caption unchanged when dropped inside their combined range", () => {
  const doc = fixture(false, false), state = EditorState.create({ doc });
  const unit = documentUnits(doc).find(unit => unit.kind === "paragraph")!;
  const destination = doc.child(0).nodeSize + doc.child(1).nodeSize;
  const movement = moveArrangementUnit(state, unit, destination)!;
  const tr = trackReviewTransaction(state, movement.tr, stamp);
  expect(tr.docChanged).toBe(false);expect(tr.doc.eq(doc)).toBe(true);
});
