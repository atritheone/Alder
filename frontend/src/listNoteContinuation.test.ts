import { expect, it } from "vitest";
import { continueNote } from "./noteContinuation";
import { documentText } from "./textProjection";
import { indexNoteParagraphs } from "./richNoteLayout";
import type { DocNode } from "./types";
const p = (text: string): DocNode => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const item = (...content: DocNode[]): DocNode => ({
  type: "list_item",
  content,
});
const source: DocNode = {
  type: "doc",
  content: [
    {
      type: "ordered_list",
      attrs: { order: 4, continuePrevious: true },
      content: [
        item(p("First")),
        item(p("Second long item")),
        item(p("Third")),
      ],
    },
    p("After"),
  ],
};

it("retains list numbering, formatting and exact narration offsets inside an item", () => {
  const before = JSON.stringify(source);
  const tail = continueNote(source, 13, 0);
  expect(tail.document.content![0].attrs).toMatchObject({
    order: 5,
    continuePrevious: false,
  });
  expect(documentText(tail.document)).toBe(documentText(source).slice(13));
  expect(tail.suppressedMarkers).toEqual([0]);
  const starts = indexNoteParagraphs(tail.document, 0, tail.offsets);
  expect([...starts.values()]).toEqual([13, 23, 29]);
  expect(JSON.stringify(source)).toBe(before);
});

it("shows a marker for an unread item's first line", () => {
  const tail = continueNote(source, 6, 0);
  expect(tail.suppressedMarkers).toEqual([]);
  expect(tail.document.content![0].attrs!.order).toBe(5);
  expect(documentText(tail.document)).toBe(documentText(source).slice(6));
});

it("retains a nested list after its parent paragraph has been read", () => {
  const source: DocNode = {
    type: "doc",
    content: [
      {
        type: "bullet_list",
        content: [
          item(p("Parent"), {
            type: "ordered_list",
            attrs: { order: 3 },
            content: [item(p("Nested one")), item(p("Nested two"))],
          }),
          item(p("Last")),
        ],
      },
    ],
  };
  const tail = continueNote(source, 9, 0);
  expect(tail.hiddenParagraphs).toEqual([0]);
  expect(tail.suppressedMarkers).toEqual([0, 1]);
  expect(tail.offsets).toEqual([9, 9, 18, 29]);
  const actual: string[] = [];
  const walk = (node: DocNode) => {
    if (node.type === "paragraph" && node.content?.length)
      actual.push(documentText(node));
    node.content?.forEach(walk);
  };
  walk(tail.document);
  expect(actual).toEqual(["sted one", "Nested two", "Last"]);
});

it("refuses structures which need independent cursors and invalid numbering", () => {
  for (const [child, error] of [
    [{ type: "table" }, "containing tables"],
    [
      { type: "ordered_list", attrs: { listTemplate: [] } },
      "invalid outline numbering",
    ],
  ] as const) {
    const source: DocNode = {
      type: "doc",
      content: [{ type: "bullet_list", content: [item(p("Before"), child)] }],
    };
    expect(() => continueNote(source, 0, 0)).toThrow(error);
  }
});

it("retains picture order and text offsets when a list continues between adjacent pictures", () => {
  const a: DocNode = { type: "inline_image", attrs: { blockId: "a" } },
    b: DocNode = { type: "inline_image", attrs: { blockId: "b" } };
  const source: DocNode = {
    type: "doc",
    content: [
      {
        type: "ordered_list",
        attrs: { order: 4 },
        content: [
          item({
            type: "paragraph",
            content: [a, b, { type: "text", text: "First" }],
          }),
          item(p("Second")),
        ],
      },
    ],
  };
  const tail = continueNote(source, 0, 1);
  expect(tail.pictureSources).toEqual([{ from: 0, images: 1 }]);
  expect(tail.imageStarts).toEqual([1, 2]);
  expect(tail.suppressedMarkers).toEqual([0]);
  expect(documentText(tail.document)).toBe("First\nSecond");
  const indexed = indexNoteParagraphs(
    tail.document,
    0,
    tail.offsets,
    tail.imageStarts,
    tail.pictureSources,
  );
  expect([...indexed.values()]).toEqual([0, 6]);
  expect(indexed.pictures).toEqual([{ from: 0, images: 1 }]);
  expect([...indexed.imageStarts.values()]).toEqual([1, 2]);
});
