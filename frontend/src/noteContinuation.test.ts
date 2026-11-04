import { expect, it } from "vitest";
import { continueNote } from "./noteContinuation";
import { documentText } from "./textProjection";
import type { DocNode } from "./types";
const text = (value: string): DocNode => ({
  type: "text",
  text: value,
  marks: [{ type: "strong" }],
});
const image = (id: string, block = false): DocNode => ({
  type: block ? "image" : "inline_image",
  attrs: { blockId: id, alt: id, width: 80 },
});
const paragraph = (...content: DocNode[]): DocNode => ({
  type: "paragraph",
  attrs: { firstLineIndent: 20 },
  content,
});
const source: DocNode = {
  type: "doc",
  content: [
    paragraph(text("Before"), image("one"), image("two"), text("After")),
    image("block", true),
    paragraph(text("Last paragraph")),
  ],
};

it("distinguishes consecutive pictures at the same narration offset", () => {
  const before = JSON.stringify(source);
  const tail = continueNote(source, 6, 1);
  expect(tail.from).toBe(6);
  expect(tail.images).toBe(1);
  expect(tail.document.content![0].content).toEqual([
    image("two"),
    text("After"),
  ]);
  expect(tail.document.content![0].attrs!.firstLineIndent).toBe(0);
  expect(documentText(tail.document)).toBe(documentText(source).slice(6));
  expect(JSON.stringify(source)).toBe(before);
});

it("retains an unread block picture and its following paragraph separator", () => {
  const tail = continueNote(source, 12, 2);
  expect(tail.document.content).toEqual([
    image("block", true),
    paragraph(text("Last paragraph")),
  ]);
  expect(documentText(tail.document)).toBe(documentText(source).slice(12));
  expect(continueNote(source, 13, 3).document.content).toEqual([
    paragraph(text("Last paragraph")),
  ]);
});

it("slices marked prose and hard breaks with exact original offsets", () => {
  const source: DocNode = {
    type: "doc",
    content: [paragraph(text("First"), { type: "hard_break" }, text("Last"))],
  };
  for (const from of [0, 2, 5, 6, 8])
    expect(documentText(continueNote(source, from, 0).document)).toBe(
      documentText(source).slice(from),
    );
  expect(
    continueNote(source, 2, 0).document.content![0].content![0].marks,
  ).toEqual([{ type: "strong" }]);
});

it("keeps explicit empty paragraphs but does not invent one before a continuation", () => {
  const source: DocNode = {
    type: "doc",
    content: [paragraph(text("First")), paragraph(), paragraph(text("Last"))],
  };
  expect(continueNote(source, 7, 0).document.content).toEqual([
    paragraph(text("Last")),
  ]);
  expect(documentText(continueNote(source, 6, 0).document)).toBe("\nLast");
});

it("does not silently flatten parallel table content", () => {
  expect(() =>
    continueNote({ type: "doc", content: [{ type: "table" }] }, 0, 0),
  ).toThrow("lists or tables");
});
