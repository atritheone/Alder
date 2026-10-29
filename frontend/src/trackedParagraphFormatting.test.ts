import { it, expect } from "vitest";
import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { schema as base } from "./Editor";
import {
  trackParagraphFormatting,
  resolveParagraphFormatting,
  paragraphFormatView,
} from "./trackedParagraphFormatting";
const schema = new Schema({
  nodes: base.spec.nodes
    .update("paragraph", {
      ...base.nodes.paragraph.spec,
      attrs: {
        ...base.nodes.paragraph.spec.attrs,
        revisionProperties: { default: null },
      },
    })
    .update("heading", {
      ...base.nodes.heading.spec,
      attrs: {
        ...base.nodes.heading.spec.attrs,
        revisionProperties: { default: null },
      },
    }),
  marks: base.spec.marks,
});
const a = { id: "a", author: "First", date: "" },
  b = { id: "b", author: "Second", date: "" };
const initial = () =>
  EditorState.create({
    doc: schema.node("doc", null, [
      schema.node(
        "paragraph",
        { blockId: "p", align: "left", spaceAfter: 0 },
        schema.text("Words"),
      ),
    ]),
    plugins: [history()],
  });
it("keeps later accepted spacing when an earlier alignment change is rejected", () => {
  let state = initial();
  const change = (attrs: Record<string, unknown>, stamp: typeof a) => {
    const tr = state.tr.setNodeMarkup(0, undefined, {
      ...state.doc.firstChild!.attrs,
      ...attrs,
    });
    state = state.apply(trackParagraphFormatting(state, tr, stamp)!);
  };
  change({ align: "center" }, a);
  change({ spaceAfter: 12 }, b);
  expect(
    paragraphFormatView(state.doc, "original").firstChild!.attrs,
  ).toMatchObject({ align: "left", spaceAfter: 0 });
  state = state.apply(
    resolveParagraphFormatting(state, new Set([b.id]), "accept"),
  );
  expect(
    paragraphFormatView(state.doc, "original").firstChild!.attrs,
  ).toMatchObject({ align: "left", spaceAfter: 12 });
  state = state.apply(
    resolveParagraphFormatting(state, new Set([a.id]), "reject"),
  );
  expect(state.doc.firstChild!.attrs).toMatchObject({
    blockId: "p",
    align: "left",
    spaceAfter: 12,
    revisionProperties: null,
  });
  undo(state, (tr) => {
    state = state.apply(tr);
  });
  expect(state.doc.firstChild!.attrs.revisionProperties).not.toBeNull();
});
it("tracks heading conversion without changing wording or identity", () => {
  let state = initial();
  const original = state.doc;
  state = state.apply(
    trackParagraphFormatting(
      state,
      state.tr.setNodeMarkup(0, schema.nodes.heading, {
        ...state.doc.firstChild!.attrs,
        level: 3,
      }),
      a,
    )!,
  );
  expect(state.doc.firstChild!.type.name).toBe("heading");
  expect(paragraphFormatView(state.doc, "original").eq(original)).toBe(true);
  state = state.apply(
    resolveParagraphFormatting(state, new Set([a.id]), "reject"),
  );
  expect(state.doc.eq(original)).toBe(true);
});
it("does not misclassify text edits or list wrapping as paragraph formatting", () => {
  const state = initial();
  expect(
    trackParagraphFormatting(state, state.tr.insertText("New", 1), a),
  ).toBeNull();
  expect(
    trackParagraphFormatting(
      state,
      state.tr.replaceWith(
        0,
        state.doc.content.size,
        schema.nodes.blockquote.create(null, state.doc.content),
      ),
      a,
    ),
  ).toBeNull();
  const mixed = EditorState.create({
    doc: schema.node("doc", null, [
      state.doc.firstChild!,
      schema.node("paragraph", null, schema.text("Other")),
    ]),
  });
  const tr = mixed.tr
    .setNodeMarkup(0, undefined, {
      ...mixed.doc.firstChild!.attrs,
      align: "center",
    })
    .insertText("Else!", 8, 13);
  expect(trackParagraphFormatting(mixed, tr, a)).toBeNull();
});
