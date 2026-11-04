// @vitest-environment jsdom
import { it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import { schema } from "./Editor";
import { blockIdentities, identifiedDocument } from "./blockIdentities";
import { documentUnits, moveArrangementUnit } from "./arrangementUnits";
import { trackReviewTransaction, reviewedDocument } from "./trackedReview";
import { validateReviewMoves } from "./trackedMoves";
import { numberedDocument, chapterCaptionStarts } from "./documentCaptions";
import { referenceRefreshTransaction } from "./documentReferences";
import type { Project } from "./types";

it("counts live caption sequences and retains the original identity after either decision", () => {
  const caption = (id: string, value: string) => schema.node("paragraph", { captionLabel: "Figure" }, [schema.text("Figure "), schema.node("sequence", { blockId: id, sequenceName: "Figure" }, schema.text(value), [schema.marks.strong.create()]), schema.text(": Description.")]);
  const original = identifiedDocument(schema.node("doc", null, [caption("one", "1"), caption("two", "2")]));
  const initial = EditorState.create({ doc: original, plugins: [blockIdentities()] });
  const movement = moveArrangementUnit(initial, documentUnits(initial.doc).find(unit => unit.kind === "paragraph")!, initial.doc.content.size)!;
  let state = initial.applyTransaction(trackReviewTransaction(initial, movement.tr, { id: "sequences", author: "Reviewer", date: "" })).state;
  const counts = { Figure: 0, Table: 0 }, refreshed = numberedDocument(state.doc.toJSON(), counts);
  expect(counts).toEqual({ Figure: 2, Table: 0 });
  state = state.applyTransaction(referenceRefreshTransaction(state, schema.nodeFromJSON(refreshed))!).state;
  validateReviewMoves(state.doc);
  const all: string[] = [];state.doc.descendants(node => { if (node.type.name === "sequence") all.push(node.textContent); });
  expect(all).toEqual(["2", "1", "2"]);
  expect(chapterCaptionStarts({ book: { chapters: [{ id: "first", document: refreshed }, { id: "next" }] } } as Project, "next")).toEqual({ Figure: 2, Table: 0 });
  for (const view of ["original", "final"] as const) {
    const result = reviewedDocument(state.doc, view), values: string[] = [], ids: string[] = [];
    result.descendants(node => { if (node.type.name === "sequence") { ids.push(node.attrs.blockId);expect(node.marks[0].type.name).toBe("strong"); } });
    expect(ids).toEqual(view === "original" ? ["one", "two"] : ["two", "one"]);
    const numbered = schema.nodeFromJSON(numberedDocument(result.toJSON(), { Figure: 0, Table: 0 }));
    numbered.descendants(node => { if (node.type.name === "sequence") values.push(node.textContent); });
    expect(values).toEqual(["1", "2"]);
  }
});
