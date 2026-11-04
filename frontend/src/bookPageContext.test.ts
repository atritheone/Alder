import { expect, it } from "vitest";
import { schema } from "./Editor";
import { bookPageContext } from "./bookPageContext";
import type { FlowPage, PageLayout } from "./pageFlow";

const p = (text: string) => schema.node("paragraph", null, text ? schema.text(text) : []);
const layout: PageLayout = { width: 600, height: 800, margin: 40, lineHeight: 1.5, zoom: 1, firstPageNumber: 1 };
const page = (from: number, to: number): FlowPage => ({ from, to, text: "" });
it("uses measured shared pages, generated prefixes and section labels without changing authored text", () => {
  const doc = schema.node("doc", null, [p("Book title 😀"), p("First"), p("First body."), p("Second"), p("Second body.")]);
  const from = doc.child(0).nodeSize, middle = from + doc.child(1).nodeSize + doc.child(2).nodeSize;
  const chapters = [
    { id: "a", title: "First", fromBlock: 1, bodyFromBlock: 2, toBlock: 3 },
    { id: "b", title: "Second", fromBlock: 3, bodyFromBlock: 4, toBlock: 5 },
  ];
  const before = JSON.stringify(doc.toJSON());
  const shared = bookPageContext(doc, [page(0, doc.content.size)], layout, chapters);
  expect(shared.map(c => c.pageIndexes)).toEqual([[0], [0]]);
  expect(shared.map(c => c.startsOnSharedPage)).toEqual([true, true]);
  expect(shared[0].from).toBe("Book title 😀".length + 2);
  const pages = [page(0, middle), { ...page(middle, doc.content.size), frame: { top: 828, left: 0, layout: { ...layout, pageNumberOffset: 6, pageNumberFormat: "lowerRoman" as const } } }];
  const separate = bookPageContext(doc, pages, layout, chapters);
  expect(separate[1]).toMatchObject({ pageIndexes: [1], bodyPage: 1, bodyPageLabel: "vii", startsOnSharedPage: false });
  expect(JSON.stringify(doc.toJSON())).toBe(before);
});

it("attributes continued note-only sheets to their source chapter and preserves disjoint table ownership", () => {
  const note = schema.node("document_note", { blockId: "note_a", kind: "endnote", body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Note" }] }] } });
  const first = schema.node("paragraph", null, [schema.text("A"), note]);
  const doc = schema.node("doc", null, [first, p("Second.")]);
  const n = first.nodeSize, size = doc.content.size;
  const pages = [
    { ...page(0, n), fragments: [{ from: 0, to: 2 }, { from: 3, to: n }] },
    { ...page(2, n), fragments: [{ from: 2, to: 3 }] },
    page(n, size),
    { ...page(size, size), noteHTML: '<section data-note-fragment="note_a">Note</section>' },
  ];
  const result = bookPageContext(doc, pages, layout, [
    { id: "a", title: "A", fromBlock: 0, bodyFromBlock: 0, toBlock: 1 },
    { id: "b", title: "B", fromBlock: 1, bodyFromBlock: 1, toBlock: 2 },
  ]);
  expect(result[0].pageIndexes).toEqual([0, 1, 3]);
  expect(result[1].pageIndexes).toEqual([2]);
});

it("rejects stale/overlapping chapter boundaries", () => {
  const doc = schema.node("doc", null, [p("One"), p("Two")]), pages = [page(0, doc.content.size)];
  const a = { id: "a", title: "A", fromBlock: 0, bodyFromBlock: 0, toBlock: 1 };
  for (const entries of [[{ ...a, toBlock: 3 }], [a, { ...a, id: "b" }], [a, { ...a, fromBlock: 1, bodyFromBlock: 1, toBlock: 2 }]])
    expect(() => bookPageContext(doc, pages, layout, entries)).toThrow(/boundaries/);
});
