// @vitest-environment jsdom
import { it, expect, afterEach } from "vitest";
import {
  noteSemanticPaths,
  prepareNotePublicationSemantics,
  type NoteSemanticPath,
} from "./noteSemantics";
import { indexNoteParagraphs } from "./richNoteLayout";
import type { DocNode } from "./types";
afterEach(() => document.body.replaceChildren());
const p = (text: string, id: string): DocNode => ({
  type: "paragraph",
  attrs: { blockId: id },
  content: [{ type: "text", text }],
});
it("retains nested list/table ancestry, spans and original container identities", () => {
  const body: DocNode = {
    type: "doc",
    content: [
      {
        type: "ordered_list",
        attrs: { blockId: "list" },
        content: [
          {
            type: "list_item",
            attrs: { blockId: "item" },
            content: [
              p("First", "p1"),
              {
                type: "table",
                attrs: { blockId: "table" },
                content: [
                  {
                    type: "table_row",
                    attrs: { blockId: "row" },
                    content: [
                      {
                        type: "table_header",
                        attrs: { blockId: "cell", colspan: 2, rowspan: 3 },
                        content: [p("Header", "p2")],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const paths = noteSemanticPaths(body),
    path = paths.paragraphs.get("p2")!;
  expect(path.map((p) => p.role)).toEqual([
    "list",
    "listitem",
    "table",
    "row",
    "columnheader",
    "paragraph",
  ]);
  expect(path.find((p) => p.key === "cell")).toMatchObject({
    colSpan: 2,
    rowSpan: 3,
  });
  const offsets = indexNoteParagraphs(body, 0);
  expect(
    offsets.semantics.paragraphs
      .get("note_measure_1")!
      .map((p) => p.key)
      .slice(0, -1),
  ).toEqual(["list", "item", "table", "row", "cell"]);
});
it("keeps standalone images in source order and inline images in their paragraph", () => {
  const body: DocNode = {
    type: "doc",
    content: [
      { type: "image", attrs: { blockId: "picture" } },
      p("Text", "body"),
    ],
  };
  body.content![1].content!.push({
    type: "inline_image",
    attrs: { blockId: "inline" },
  });
  const paths = noteSemanticPaths(body);
  expect(paths.pictures[0]).toEqual([
    { key: "picture", role: "presentation", order: 0 },
  ]);
  expect(paths.pictures[1]).toEqual(paths.paragraphs.get("body"));
});
it("reassembles reading order without moving the measured ink boxes or losing links", () => {
  const sheet = document.createElement("section");
  sheet.className = "publication-sheet";
  sheet.getBoundingClientRect = () => ({ left: 40, top: 100 }) as DOMRect;
  document.body.append(sheet);
  const path = (cell: string, order: number): NoteSemanticPath => [
    { key: "table", role: "table", order: 0 },
    { key: "row", role: "row", order: 0 },
    { key: cell, role: "cell", order, colSpan: 2 },
    { key: "p_" + cell, role: "paragraph", order: 0 },
  ];
  const insert = (
    text: string,
    path: NoteSemanticPath,
    order: number,
    top: number,
    repeated = false,
  ) => {
    const fragment = document.createElement("div");
    fragment.dataset.noteFragment = "note";
    fragment.id = sheet.children.length ? "" : "note-body_note";
    if (repeated) {
      fragment.dataset.noteRepeatedHeader = "true";
      fragment.setAttribute("aria-hidden", "true");
    }
    const link = document.createElement("a");
    link.href = "https://example.com";
    const ink = document.createElement("span");
    ink.textContent = text;
    ink.dataset.noteStructure = JSON.stringify(path);
    ink.dataset.noteOrder = JSON.stringify([order]);
    ink.getBoundingClientRect = () =>
      ({ left: 60, top, width: 80, height: 12 }) as DOMRect;
    link.append(ink);
    fragment.append(link);
    sheet.append(fragment);
    return ink;
  };
  const right = insert("Right", path("right", 1), 10, 120),
    last = insert("last", path("left", 0), 5, 140),
    first = insert("First", path("left", 0), 0, 130);
  insert("Repeated First", path("left", 0), 0, 160, true);
  prepareNotePublicationSemantics();
  const story = sheet.querySelector("[data-published-note]")!;
  expect(story.textContent).toBe("FirstlastRight");
  expect(story.id).toBe("");
  expect(sheet.querySelector("#note-body_note")?.getAttribute("role")).toBe("presentation");
  expect(story.querySelectorAll('[role="table"]')).toHaveLength(1);
  expect(
    story.querySelectorAll('[role="cell"][aria-colspan="2"]'),
  ).toHaveLength(2);
  expect(story.querySelectorAll('a[href="https://example.com"]')).toHaveLength(
    3,
  );
  expect(
    [first, last, right].map((el) => [
      el.style.top,
      el.style.left,
      el.style.width,
    ]),
  ).toEqual([
    ["30px", "20px", "80px"],
    ["40px", "20px", "80px"],
    ["20px", "20px", "80px"],
  ]);
});
