import { describe, it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import { schema, parseEditorDocument } from "./Editor";
import {
  projectText,
  projectedRange,
  wordAtPosition,
  documentText,
  generatedTextSpans,
  intersectsTextSpans,
} from "./textProjection";
import type { DocNode } from "./types";
import type { Node as PMNode } from "prosemirror-model";

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
  it("keeps every packed boundary identical through mixed structure edits and undo", () => {
    // Independent recursive reference: concatenate child projections, including
    // the right-affinity boundary of empty objects and deleted wording.
    const separated = new Set([
      "doc",
      "blockquote",
      "bullet_list",
      "ordered_list",
      "list_item",
      "table",
      "table_cell",
      "table_header",
    ]);
    const silent = new Set([
      "bookmark",
      "bookmark_end",
      "document_note",
      "image",
      "inline_image",
      "page_break",
    ]);
    const reference = (
      node: PMNode,
      position = 0,
      root = true,
    ): { text: string; map: number[] } => {
      if (
        node.marks.some((mark) => mark.type.name === "revision_deletion") ||
        silent.has(node.type.name)
      )
        return { text: "", map: [position + node.nodeSize] };
      if (node.isText)
        return {
          text: node.text!,
          map: Array.from(
            { length: node.text!.length + 1 },
            (_, i) => position + i,
          ),
        };
      if (node.type.name === "hard_break")
        return { text: "\n", map: [position, position + 1] };
      const start = root ? 0 : position + 1,
        parts: { text: string; map: number[] }[] = [];
      node.forEach((child, offset) =>
        parts.push(reference(child, start + offset, false)),
      );
      const separator =
        node.type.name === "table_row"
          ? "\t"
          : separated.has(node.type.name)
            ? "\n"
            : "";
      const result = parts.shift() || { text: "", map: [start] };
      for (const part of parts) {
        result.text += separator + part.text;
        if (!separator) result.map.pop();
        result.map.push(...part.map);
      }
      return node.type.name === "text_box"
        ? {
            text: "\n" + result.text + "\n",
            map: [position, ...result.map, position + node.nodeSize],
          }
        : result;
    };
    let seed = 137;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed;
    };
    const atoms: DocNode[] = [
      { type: "text", text: "A😀e\u0301 ไทย" },
      { type: "text", text: "marked", marks: [{ type: "strong" }] },
      { type: "hard_break" },
      { type: "bookmark", attrs: { name: "point", blockId: "point" } },
      { type: "text_box", content: [{ type: "text", text: "inside" }] },
      { type: "inline_image", attrs: { src: "/image" } },
      {
        type: "text",
        text: "deleted",
        marks: [
          {
            type: "revision_deletion",
            attrs: { id: "change", author: "Author", date: "" },
          },
        ],
      },
    ];
    for (let iteration = 0; iteration < 80; iteration++) {
      const paragraphs: DocNode[] = Array.from({ length: 12 }, () => ({
        type: "paragraph",
        content: Array.from(
          { length: random() % 8 },
          () => atoms[random() % atoms.length],
        ),
      }));
      const doc = document(
        paragraphs[0],
        {
          type: "table",
          content: [
            {
              type: "table_row",
              content: paragraphs
                .slice(1, 5)
                .map((p) => ({ type: "table_cell", content: [p] })),
            },
          ],
        },
        {
          type: "bullet_list",
          content: paragraphs
            .slice(5, 9)
            .map((p) => ({ type: "list_item", content: [p] })),
        },
        ...paragraphs.slice(9),
      );
      const edited = EditorState.create({ doc }).tr.insertText("new ", 1).doc;
      for (const value of [doc, edited, doc]) {
        const actual = projectText(value),
          expected = reference(value);
        expect(actual.text).toBe(expected.text);
        expect([...actual.map]).toEqual(expected.map);
        expect(actual.map.length).toBe(actual.text.length + 1);
      }
    }
  });
  it("excludes generated corrections without shifting Unicode, table or note offsets", () => {
    const doc: DocNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "😀 Before " },
            {
              type: "document_note",
              attrs: {
                body: { type: "doc", content: [paragraph("silent note")] },
              },
            },
            {
              type: "citation",
              content: [{ type: "text", text: "(Source, 2020)" }],
            },
            { type: "text", text: " after." },
          ],
        },
        {
          type: "table",
          content: [
            {
              type: "table_row",
              content: [
                cell("first"),
                {
                  type: "table_cell",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text: "hidden",
                          marks: [{ type: "revision_deletion" }],
                        },
                        {
                          type: "citation",
                          content: [{ type: "text", text: "[2]" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "bibliography",
          content: [paragraph("Sources"), paragraph("Author. Title.")],
        },
        paragraph("Last ordinary sentence."),
      ],
    };
    const text = documentText(doc),
      spans = generatedTextSpans(doc);
    expect(spans.map(({ start, end }) => text.slice(start, end))).toEqual([
      "(Source, 2020)",
      "[2]",
      "Sources\nAuthor. Title.",
    ]);
    expect(generatedTextSpans(doc)).toBe(spans);
    for (const span of spans) {
      expect(intersectsTextSpans(spans, span.start, span.end)).toBe(true);
      expect(intersectsTextSpans(spans, span.end, span.end + 1)).toBe(false);
    }
    const start = text.indexOf("ordinary");
    expect(intersectsTextSpans(spans, start, start + 8)).toBe(false);
  });
  it("finds the caret word across silent bookmarks and hard breaks", () => {
    const doc = document({
      type: "paragraph",
      content: [
        { type: "bookmark", attrs: { name: "Start" } },
        { type: "text", text: "first" },
        { type: "bookmark", attrs: { name: "End" } },
        { type: "hard_break" },
        { type: "text", text: "second" },
      ],
    });
    for (const caret of [1, 2, 4, 7, 8])
      expect(wordAtPosition(doc, caret)).toEqual({
        from: 2,
        to: 7,
        text: "first",
      });
    for (const caret of [9, 12, 15])
      expect(wordAtPosition(doc, caret)).toEqual({
        from: 9,
        to: 15,
        text: "second",
      });
  });
  it("reuses unchanged documents without serving stale positions after an edit", () => {
    const doc = document(paragraph("Read this 🌲 sentence."));
    const before = projectText(doc);
    expect(projectText(doc)).toBe(before);
    const edited = EditorState.create({ doc }).tr.insertText("new ", 1).doc;
    expect(projectText(edited).text).toBe("new Read this 🌲 sentence.");
    expect(projectText(edited)).not.toBe(before);
    expect(projectText(doc)).toBe(before);
  });
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
