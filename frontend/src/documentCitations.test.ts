import { expect, it } from "vitest";
import { processCitations } from "./citationProcessor";
import {
  validCitationItems,
  validCitationSource,
  type CitationSource,
} from "./citationTypes";
import { schema, parseEditorDocument } from "./Editor";
import { speechText } from "./speechText";
import { EditorState } from "prosemirror-state";
import { protectContents } from "./documentContents";
const source = (id: string, title: string, year = 2020): CitationSource => ({
  id,
  type: "book",
  title,
  author: [{ family: "Smith", given: "Alex" }],
  issued: { "date-parts": [[year]] },
  publisher: "Example Press",
});
it("formats author-date locators and updates earlier citations when disambiguation changes", () => {
  const result = processCitations({
    style: "apa",
    citations: [
      {
        id: "one",
        items: [{ source: source("a", "Alpha"), locator: "12–14" }],
      },
      { id: "two", items: [{ source: source("b", "Beta") }] },
      { id: "three", items: [{ source: source("a", "Alpha") }] },
    ],
  });
  expect(result.citations.one).toContain("2020a");
  expect(result.citations.one).toContain("12–14");
  expect(result.citations.two).toContain("2020b");
  expect(result.citations.three).toContain("2020a");
  expect(result.bibliography.map((entry) => entry.ids)).toEqual([["a"], ["b"]]);
  expect(result.bibliography[0].html).toContain("<i>Alpha</i>");
});
it("numbers numeric citations by first appearance and renumbers after reordering", () => {
  const a = { id: "one", items: [{ source: source("a", "Alpha") }] },
    b = { id: "two", items: [{ source: source("b", "Beta") }] };
  const first = processCitations({ style: "ieee", citations: [a, b] }),
    reordered = processCitations({ style: "ieee", citations: [b, a] });
  expect(first.citations.one).toBe("[1]");
  expect(first.citations.two).toBe("[2]");
  expect(reordered.citations.two).toBe("[1]");
  expect(reordered.bibliography.map((entry) => entry.ids)).toEqual([
    ["b"],
    ["a"],
  ]);
});
it("rejects conflicting source snapshots and invalid metadata instead of silently choosing a version", () => {
  expect(() =>
    processCitations({
      style: "apa",
      citations: [
        { id: "a", items: [{ source: source("x", "One") }] },
        { id: "b", items: [{ source: source("x", "Two") }] },
      ],
    }),
  ).toThrow("Different versions");
  expect(
    validCitationSource(JSON.parse('{"id":"x","type":"book","__proto__":{}}')),
  ).toBe(false);
  expect(
    validCitationItems([{ source: source("x", "One"), label: "invalid" }]),
  ).toBe(false);
});
it("keeps citations and bibliographies silent by default and protects their generated wording", () => {
  const document = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Before " },
          {
            type: "citation",
            attrs: {
              items: [{ source: source("x", "One") }],
              blockId: "citation1",
            },
            content: [{ type: "text", text: "(Smith, 2020)" }],
          },
          { type: "text", text: " after." },
        ],
      },
      {
        type: "bibliography",
        attrs: { title: "References", entryIds: [["x"]], renderedStyle: "apa" },
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "References" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Smith. One." }],
          },
        ],
      },
    ],
  };
  const doc = parseEditorDocument(document).document!;
  expect(doc).not.toBeNull();
  expect(speechText(doc).text).toBe("Before after.");
  expect(speechText(doc, 0, undefined, true).text).toContain("(Smith, 2020)");
  const state = EditorState.create({ doc, plugins: [protectContents()] });
  const altered = state.tr.insertText("bad", 10);
  expect(state.apply(altered).doc.eq(doc)).toBe(true);
  expect(
    parseEditorDocument({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "citation", attrs: { items: [] } }],
        },
      ],
    }).document,
  ).toBeNull();
});
