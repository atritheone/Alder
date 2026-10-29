import { it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import { schema } from "./Editor";
import {
  pageReferenceValues,
  pageReferenceTransaction,
} from "./pageReferences";
import type { PageLayout } from "./pageFlow";
it("uses physical ownership with section restarts and Roman labels", () => {
  const doc = schema.node("doc", null, [
    schema.node("heading", { blockId: "first" }, schema.text("First")),
    schema.node("heading", { blockId: "second" }, schema.text("Second")),
  ]);
  const layout = {
    firstPageNumber: 4,
    pageNumberFormat: "lowerRoman",
  } as PageLayout;
  const split = doc.firstChild!.nodeSize;
  const values = pageReferenceValues(
    doc,
    [
      { from: 0, to: split, text: "First" },
      {
        from: split,
        to: doc.content.size,
        text: "Second",
        frame: {
          top: 0,
          left: 0,
          layout: {
            ...layout,
            pageNumberFormat: "decimal",
            pageNumberOffset: 8,
          },
        },
      },
    ],
    layout,
  );
  expect(values).toEqual({
    references: { first: "iv", second: "9" },
    pages: 2,
  });
});
it("refreshes page fields without touching authored text or adding an undo event", () => {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [
      schema.text("Page "),
      schema.node(
        "cross_reference",
        { targetId: "heading", referenceFormat: "page" },
        schema.text("—"),
      ),
      schema.text(" body"),
    ]),
  ]);
  const state = EditorState.create({ doc });
  const tr = pageReferenceTransaction(state, {
    references: { heading: "iv" },
    pages: 4,
  })!;
  expect(tr.getMeta("addToHistory")).toBe(false);
  const next = state.apply(tr);
  expect(next.doc.textContent).toBe("Page iv body");
  expect(
    pageReferenceTransaction(next, { references: { heading: "iv" }, pages: 4 }),
  ).toBeNull();
  const missing = pageReferenceTransaction(next, { references: {}, pages: 4 })!;
  expect(next.apply(missing).doc.firstChild!.child(1).attrs.unresolved).toBe(
    true,
  );
  expect(next.apply(missing).doc.textContent).toBe("Page iv body");
});

it("resolves inline page and total-page fields at their own positions", () => {
  const field = (kind: string, id: string) =>
    schema.nodes.document_field.create(
      { fieldKind: kind, blockId: id },
      schema.text("—"),
    );
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [
      field("page", "front"),
      schema.text(" of "),
      field("pageCount", "count"),
    ]),
    schema.node("paragraph", null, field("page", "body")),
  ]);
  const split = doc.firstChild!.nodeSize,
    layout = {
      firstPageNumber: 4,
      pageNumberFormat: "lowerRoman",
    } as PageLayout;
  const values = pageReferenceValues(
    doc,
    [
      { from: 0, to: split, text: "" },
      {
        from: split,
        to: doc.content.size,
        text: "",
        frame: {
          top: 0,
          left: 0,
          layout: {
            ...layout,
            pageNumberFormat: "decimal",
            pageNumberOffset: 8,
          },
        },
      },
    ],
    layout,
  );
  expect(values.fields).toEqual({ front: "iv", count: "2", body: "9" });
  const state = EditorState.create({ doc }),
    tr = pageReferenceTransaction(state, values)!;
  expect(state.apply(tr).doc.textContent).toBe("iv of 29");
  expect(tr.getMeta("referenceRefresh")).toBe(true);
});
