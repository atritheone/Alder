import { describe, it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import { schema, parseEditorDocument } from "./Editor";
import { projectText, projectedRange } from "./textProjection";
import type { DocNode } from "./types";

const paragraph = (text = ""): DocNode => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }] : [],
});
const document = (...content: DocNode[]) =>
  schema.nodeFromJSON({ type: "doc", content });
const cell = (text = ""): DocNode => ({
  type: "table_cell",
  content: [paragraph(text)],
});

describe("canonical document text and source boundaries", () => {
  it("preserves leading, consecutive and trailing empty paragraphs", () => {
    const doc = document(
      paragraph(),
      paragraph("word"),
      paragraph(),
      paragraph(),
    );
    const projection = projectText(doc);
    expect(projection.text).toBe("\nword\n\n");
    expect(projection.map).toHaveLength(projection.text.length + 1);
    const range = projectedRange(doc, 1, 5);
    expect(doc.textBetween(range.from, range.to)).toBe("word");
    expect(
      projectText(
        EditorState.create({ doc }).tr.insertText("term", range.from, range.to)
          .doc,
      ).text,
    ).toBe("\nterm\n\n");
  });
  it("maps UTF-16 emoji and accented text without changing either", () => {
    const doc = document(paragraph("😀 café e\u0301lan"));
    const projection = projectText(doc);
    expect(projection.text).toBe("😀 café e\u0301lan");
    const range = projectedRange(doc, 3, 7);
    expect(doc.textBetween(range.from, range.to)).toBe("café");
    expect(() => projectedRange(doc, 1, 2)).toThrow(RangeError);
    expect(projectedRange(doc, 0, 2)).toEqual({ from: 1, to: 3 });
  });
  it("uses tabs between table cells and preserves empty cells", () => {
    const doc = document({
      type: "table",
      content: [
        { type: "table_row", content: [cell(), cell("first")] },
        { type: "table_row", content: [cell("second"), cell()] },
      ],
    });
    expect(projectText(doc).text).toBe("\tfirst\nsecond\t");
    const range = projectedRange(doc, 1, 6);
    expect(doc.textBetween(range.from, range.to)).toBe("first");
    const updated = EditorState.create({ doc }).tr.insertText(
      "revised",
      range.from,
      range.to,
    ).doc;
    expect(projectText(updated).text).toBe("\trevised\nsecond\t");
    expect(updated.firstChild?.childCount).toBe(2);
  });
  it("preserves paragraph separators around silent images and page breaks", () => {
    const doc = document(
      paragraph("before"),
      { type: "image", attrs: { src: "/api/asset", alt: "not spoken" } },
      { type: "page_break" },
      paragraph("after"),
    );
    expect(projectText(doc).text).toBe("before\n\n\nafter");
    const range = projectedRange(doc, 9, 14);
    expect(doc.textBetween(range.from, range.to)).toBe("after");
    const updated = EditorState.create({ doc }).tr.insertText(
      "later",
      range.from,
      range.to,
    ).doc;
    expect(updated.child(1).type.name).toBe("image");
    expect(projectText(updated).text).toBe("before\n\n\nlater");
  });
  it("preserves nested list structure and hard breaks in the projection", () => {
    const doc = document(
      {
        type: "bullet_list",
        content: [
          { type: "list_item", content: [paragraph(), paragraph("first")] },
          {
            type: "list_item",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "second" },
                  { type: "hard_break" },
                  { type: "text", text: "line" },
                ],
              },
            ],
          },
        ],
      },
      paragraph("last"),
    );
    expect(projectText(doc).text).toBe("\nfirst\nsecond\nline\nlast");
    const offset = projectText(doc).text.indexOf("line");
    const range = projectedRange(doc, offset, offset + 4);
    expect(doc.textBetween(range.from, range.to)).toBe("line");
  });
  it("rejects out-of-bounds, reversed and stale ranges", () => {
    const doc = document(paragraph("current"));
    expect(() => projectedRange(doc, -1, 2)).toThrow(RangeError);
    expect(() => projectedRange(doc, 3, 2)).toThrow(RangeError);
    expect(() => projectedRange(doc, 0, 99)).toThrow(RangeError);
    expect(() => projectedRange(doc, 0.5, 2)).toThrow(RangeError);
    expect(() => projectedRange(doc, 0, 3, "earlier")).toThrow(/earlier text/);
  });
  it("maps a long manuscript block without exceeding JavaScript argument limits", () => {
    const text = "word ".repeat(50000);
    const doc = document(paragraph(), paragraph(text));
    expect(projectText(doc).text).toBe("\n" + text);
    const range = projectedRange(doc, text.length - 3, text.length);
    expect(doc.textBetween(range.from, range.to)).toBe("ord");
  });
  it("reports unsupported source without manufacturing replacement text", () => {
    const source: DocNode = {
      type: "doc",
      content: [
        paragraph("Preserve this."),
        { type: "footnote", content: [paragraph("Important source note.")] },
      ],
    };
    const before = JSON.stringify(source);
    const parsed = parseEditorDocument(source);
    expect(parsed.document).toBeNull();
    expect(parsed.error).toMatch(/cannot edit/);
    expect(JSON.stringify(source)).toBe(before);
  });
  it("preserves future attributes instead of silently normalising them away", () => {
    const source: DocNode = {
      type: "doc",
      content: [
        {
          ...paragraph("Retain this metadata."),
          attrs: { futureLayoutMode: "facing-pages" },
        },
      ],
    };
    const before = JSON.stringify(source);
    const parsed = parseEditorDocument(source);
    expect(parsed.document).toBeNull();
    expect(parsed.error).toMatch(/cannot edit/);
    expect(JSON.stringify(source)).toBe(before);
    const marked: DocNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Retain tracking.",
              marks: [{ type: "text_style", attrs: { tracking: 2 } }],
            },
          ],
        },
      ],
    };
    expect(parseEditorDocument(marked).document).toBeNull();
  });
});
