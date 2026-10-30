import { expect, it } from "vitest";
import { proofreadingLanguages,type ProofreadingLanguageProject } from "./proofreadingLanguages";
import { documentText } from "./textProjection";
import type { DocNode } from "./types";
const project = {
  language: "en",
  settings: { proofreadingDialect: "en-GB" },
  styles: [
    { id: "base", name: "French", textLanguage: "fr" },
    { id: "derived", name: "French body", basedOn: "base" },
  ],
} satisfies ProofreadingLanguageProject;
const p = (text: string, attrs = {}) => ({
  type: "paragraph",
  attrs,
  content: [{ type: "text", text }],
});
it("follows paragraph/style language, UTF-16 and table separators without including deleted or generated wording", () => {
  const doc: DocNode = {
    type: "doc",
    content: [
      p("😀 English"),
      p("Bonjour", { styleId: "derived" }),
      {
        type: "table",
        content: [
          {
            type: "table_row",
            content: [
              {
                type: "table_cell",
                content: [p("Deutsch", { textLanguage: "de-DE" })],
              },
              { type: "table_cell", content: [p("English")] },
            ],
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "gone",
            marks: [{ type: "revision_deletion" }],
          },
          { type: "text", text: "Keep" },
          {
            type: "document_note",
            attrs: { body: { type: "doc", content: [p("Hidden note")] } },
          },
          { type: "citation", content: [{ type: "text", text: "(Author)" }] },
        ],
      },
    ],
  };
  const text = documentText(doc),
    ranges = proofreadingLanguages(doc, project);
  expect(ranges.map((s) => text.slice(s.start, s.end)).join("")).toBe(text);
  expect(
    ranges.find((s) => text.slice(s.start, s.end) === "Bonjour")?.language,
  ).toBe("fr");
  expect(
    ranges.find((s) => text.slice(s.start, s.end) === "Deutsch")?.language,
  ).toBe("de-DE");
  expect(ranges.at(-1)?.language).toBe("zxx");
  expect(ranges[0].end).toBe(11);
  expect(text).not.toContain("gone");
  expect(text).not.toContain("Hidden note");
});
it("uses a draft language and invalidates ranges when only inherited language changes", () => {
  const doc = {
    type: "doc",
    content: [
      p("Bonjour", { styleId: "derived" }),
      p("Words", { textLanguage: "en" }),
    ],
  };
  expect(proofreadingLanguages(doc, project, "fr")[0].language).toBe("fr");
  expect(proofreadingLanguages(doc, project, "fr").at(-1)?.language).toBe(
    "en-GB",
  );
  const changed = {
    ...project,
    styles: project.styles.map((s) =>
      s.id === "base" ? { ...s, textLanguage: "es" } : s,
    ),
  };
  expect(proofreadingLanguages(doc, changed)).not.toEqual(
    proofreadingLanguages(doc, project),
  );
});
