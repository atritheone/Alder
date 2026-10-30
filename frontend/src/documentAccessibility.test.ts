import { describe, it, expect } from "vitest";
import {
  accessibilityIssues,
  projectAccessibilitySources,
} from "./documentAccessibility";
import type { DocNode } from "./types";
import { newChapter } from "./book";
const text = (value: string): DocNode => ({ type: "text", text: value });
const paragraph = (id: string, value: string): DocNode => ({
  type: "paragraph",
  attrs: { blockId: id },
  content: [text(value)],
});
const doc = (...content: DocNode[]): DocNode => ({ type: "doc", content });
describe("document accessibility checks", () => {
  it("finds structural issues without modifying the source; follows stable anchors", () => {
    const document = doc(
      {
        type: "heading",
        attrs: { level: 3, blockId: "heading" },
        content: [text("A heading")],
      },
      { type: "heading", attrs: { level: 1, blockId: "empty" } },
      { type: "image", attrs: { blockId: "image", alt: "" } },
      {
        type: "paragraph",
        attrs: { blockId: "link" },
        content: [
          {
            ...text("Click "),
            marks: [{ type: "link", attrs: { href: "https://example.com" } }],
          },
          {
            ...text("here"),
            marks: [
              { type: "link", attrs: { href: "https://example.com" } },
              { type: "strong" },
            ],
          },
        ],
      },
      {
        type: "table",
        attrs: { blockId: "table" },
        content: [
          {
            type: "table_row",
            content: [
              {
                type: "table_cell",
                attrs: { colspan: 2 },
                content: [paragraph("cell", "Data")],
              },
            ],
          },
        ],
      },
    );
    const before = JSON.stringify(document),
      issues = accessibilityIssues([
        { document, title: "Chapter", chapterId: "one" },
      ]);
    expect(issues.map((i) => i.code)).toEqual([
      "heading-order",
      "empty-heading",
      "image-description",
      "link-purpose",
      "table-headers",
      "table-merges",
    ]);
    expect(issues.map((i) => i.blockId)).toEqual([
      "heading",
      "empty",
      "image",
      "link",
      "table",
      "table",
    ]);
    expect(issues.every((i) => i.chapterId === "one")).toBe(true);
    expect(JSON.stringify(document)).toBe(before);
  });
  it("excludes decorative objects, deleted links, generated references, and recognises row or column headers", () => {
    const cell = (type: string) => ({ type, content: [paragraph("", "data")] });
    const table = (rows: DocNode[]): DocNode => ({
      type: "table",
      content: rows,
    });
    const document = doc(
      { type: "image", attrs: { decorative: true } },
      {
        type: "paragraph",
        content: [
          {
            ...text("here"),
            marks: [
              { type: "link", attrs: { href: "https://example.com" } },
              { type: "revision_deletion" },
            ],
          },
        ],
      },
      {
        type: "bibliography",
        content: [
          {
            type: "heading",
            attrs: { level: 6 },
            content: [text("Generated")],
          },
        ],
      },
      table([
        {
          type: "table_row",
          content: [cell("table_header"), cell("table_header")],
        },
        {
          type: "table_row",
          content: [cell("table_cell"), cell("table_cell")],
        },
      ]),
      table([
        {
          type: "table_row",
          content: [cell("table_header"), cell("table_cell")],
        },
        {
          type: "table_row",
          content: [cell("table_header"), cell("table_cell")],
        },
      ]),
    );
    expect(accessibilityIssues([{ document, title: "Document" }])).toEqual([]);
  });
  it("navigates notes and only checks active inherited running variants once", () => {
    const missing = doc({ type: "image", attrs: { blockId: "logo", alt: "" } }),
      even = doc(paragraph("link", ""));
    const issues = accessibilityIssues(
      [
        {
          title: "One",
          chapterId: "one",
          document: doc(
            {
              type: "paragraph",
              content: [
                {
                  type: "document_note",
                  attrs: {
                    blockId: "note",
                    body: doc({
                      type: "heading",
                      attrs: { blockId: "nh", level: 4 },
                      content: [text("Inside note")],
                    }),
                  },
                },
              ],
            },
            {
              type: "section_break",
              attrs: {
                blockId: "section",
                runningMatter: { differentFirst: true },
              },
            },
            {
              type: "section_break",
              attrs: { blockId: "next", runningMatter: {} },
            },
          ),
        },
      ],
      {
        differentFirst: false,
        differentEven: false,
        header: { default: missing, first: missing, even },
      },
    );
    expect(issues.filter((i) => i.code === "image-description")).toHaveLength(
      1,
    );
    expect(issues.find((i) => i.code === "heading-order")).toMatchObject({
      noteId: "note",
      blockId: "nh",
      chapterId: "one",
    });
    const first = doc({ type: "image", attrs: { blockId: "first" } });
    const inherited = accessibilityIssues(
      [
        {
          title: "Section",
          document: doc({
            type: "section_break",
            attrs: { blockId: "s", runningMatter: { differentFirst: true } },
          }),
        },
      ],
      { header: { first } },
    );
    expect(inherited).toHaveLength(1);
    expect(inherited[0]).toMatchObject({ story: "header", variant: "first" });
    expect(inherited[0].sectionId).toBeUndefined();
  });
  it("scans included chapters and treats visible publication titles as outline level one", () => {
    const chapter = (id: string, include = true, showTitle = true) => ({
      ...newChapter(
        id,
        doc({
          type: "heading",
          attrs: { level: 2, blockId: id },
          content: [text(id)],
        }),
      ),
      id,
      include,
      showTitle,
    });
    const project = {
      settings: { documentKind: "book" },
      book: {
        version: 1 as const,
        chapters: [
          chapter("one"),
          chapter("excluded", false),
          chapter("hidden title", true, false),
        ],
      },
    };
    const sources = projectAccessibilitySources(project);
    expect(sources).toHaveLength(2);
    expect(accessibilityIssues(sources).map((i) => i.blockId)).toEqual([
      "hidden title",
    ]);
  });
});
