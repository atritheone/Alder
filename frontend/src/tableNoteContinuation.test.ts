import { expect, it } from "vitest";
import { continueTableNote } from "./tableNoteContinuation";
import { documentText } from "./textProjection";
import type { DocNode } from "./types";

const p = (text: string): DocNode => ({
  type: "paragraph",
  content: text ? [{ type: "text", text, marks: [{ type: "strong" }] }] : [],
});
const cell = (text: string, header = false): DocNode => ({
  type: header ? "table_header" : "table_cell",
  content: [p(text)],
});
const row = (...content: DocNode[]): DocNode => ({
  type: "table_row",
  content,
});
const source: DocNode = {
  type: "doc",
  content: [
    {
      type: "table",
      content: [
        row(cell("Left", true), cell("Right", true)),
        row(cell("Short"), cell("Longer paragraph here")),
        row(cell("Later"), cell("Last")),
      ],
    },
  ],
};
const text = documentText(source);
it("continues parallel cells by independent offsets and keeps completed cells empty", () => {
  const before = JSON.stringify(source),
    from = text.indexOf("paragraph");
  const tail = continueTableNote(source, {
    paragraphs: [
      [0, 4],
      [1, 10],
      [2, text.indexOf("Short") + 5],
      [3, from],
    ],
    pictures: [],
  });
  const table = tail.document.content![0];
  expect(table.content).toHaveLength(3);
  expect(documentText(table.content![1])).toBe("\tparagraph here");
  expect(tail.paragraphOrigins).toEqual([0, 1, -1, 3, 4, 5]);
  expect(tail.offsets[3]).toBe(from);
  expect(tail.repeatedParagraphs).toEqual([0, 1]);
  expect(tail.hiddenParagraphs).toEqual([2]);
  expect(JSON.stringify(source)).toBe(before);
});
it("drops completed rows while retaining a full repeated header and cell formatting", () => {
  const tail = continueTableNote(source, {
    paragraphs: [
      [0, 4],
      [1, 10],
      [2, 16],
      [3, text.indexOf("Later") - 1],
    ],
    pictures: [],
  });
  expect(tail.document.content![0].content).toHaveLength(2);
  expect(documentText(tail.document)).toBe("Left\tRight\nLater\tLast");
  expect(tail.paragraphOrigins).toEqual([0, 1, 4, 5]);
});
it("retains pictures independently from text in parallel cells", () => {
  const image = (id: string): DocNode => ({
    type: "inline_image",
    attrs: { blockId: id },
  });
  const source: DocNode = {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          row(
            {
              type: "table_cell",
              content: [
                {
                  type: "paragraph",
                  content: [
                    image("a"),
                    image("b"),
                    { type: "text", text: "Left" },
                  ],
                },
              ],
            },
            {
              type: "table_cell",
              content: [
                {
                  type: "paragraph",
                  content: [image("c"), { type: "text", text: "Right" }],
                },
              ],
            },
          ),
        ],
      },
    ],
  };
  const tail = continueTableNote(source, { paragraphs: [], pictures: [0, 2] });
  expect(tail.pictureSources).toEqual([{ from: 0, images: 1, paragraph: -1 }]);
  expect(tail.imageStarts).toEqual([1, 3]);
  expect(documentText(tail.document)).toBe("Left\tRight");
});
it("retains horizontal spans and drops a completely consumed nested table", () => {
  const source: DocNode = {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          row({
            type: "table_cell",
            attrs: { colspan: 2 },
            content: [
              { type: "table", content: [row(cell("Nested"))] },
              p("After"),
            ],
          }),
        ],
      },
    ],
  };
  const tail = continueTableNote(source, {
    paragraphs: [[0, 6]],
    pictures: [],
  });
  const remaining = tail.document.content![0].content![0].content![0];
  expect(remaining.attrs!.colspan).toBe(2);
  expect(remaining.content).toMatchObject([p("After")]);
  expect(tail.offsets).toEqual([7]);
});
it("continues a heading merged into body rows without repeating their wording", () => {
  const source: DocNode = {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          row({ ...cell("Merged", true), attrs: { rowspan: 2 } }, cell("Heading", true)),
          row(cell("Next")),
          row(cell("Later"), cell("Last")),
        ],
      },
    ],
  };
  const before = JSON.stringify(source), text = documentText(source);
  const tail = continueTableNote(source, { paragraphs: [[0, 3], [1, text.indexOf("Heading") + 7]], pictures: [] });
  expect(tail.repeatedParagraphs).toEqual([]);
  expect(tail.document.content![0].content![0].content![0].attrs!.rowspan).toBe(2);
  expect(documentText(tail.document)).toBe("ged\t\nNext\nLater\tLast");
  const done = continueTableNote(source, { paragraphs: [[0, 6], [1, text.indexOf("Heading") + 7], [2, text.indexOf("Next") + 4]], pictures: [] });
  expect(documentText(done.document)).toBe("Later\tLast");
  expect(done.paragraphOrigins).toEqual([3, 4]);
  expect(JSON.stringify(source)).toBe(before);
});
it("retains a vertical grid until every connected cell story is consumed", () => {
  const source: DocNode = {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          row({ ...cell("Merged"), attrs: { rowspan: 2 } }, cell("First")),
          row(cell("Second")),
          row(cell("After left"), cell("After right")),
        ],
      },
    ],
  };
  const text = documentText(source),
    end = text.indexOf("Second") + 2;
  const tail = continueTableNote(source, {
    paragraphs: [
      [0, 6],
      [1, 12],
      [2, end],
    ],
    pictures: [],
  });
  const rows = tail.document.content![0].content!;
  expect(rows).toHaveLength(3);
  expect(rows[0].content![0].attrs!.rowspan).toBe(2);
  expect(documentText(rows[1])).toBe("cond");
  expect(tail.offsets[2]).toBe(end);
  const done = continueTableNote(source, {
    paragraphs: [
      [0, 6],
      [1, 12],
      [2, end + 4],
    ],
    pictures: [],
  });
  expect(done.document.content![0].content).toHaveLength(1);
  expect(documentText(done.document)).toBe("After left\tAfter right");
});
