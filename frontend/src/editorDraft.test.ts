import { it, expect } from "vitest";
import { createEditorDraft } from "./editorDraft";
import type { Project } from "./types";
const fixture = () =>
  ({
    id: "one",
    book: {
      chapters: [
        {
          id: "a",
          document: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Original" }],
              },
            ],
          },
          text: "Original",
        },
      ],
    },
    clips: [],
    settings: { fontSize: 12 },
  }) as unknown as Project;
it("shares untouched documents and privately clones project metadata", () => {
  const p = fixture(),
    draft = createEditorDraft(p);
  draft.project.settings.fontSize = 20;
  const result = draft.finish();
  expect(result.settings.fontSize).toBe(20);
  expect(p.settings.fontSize).toBe(12);
  expect(result.book!.chapters[0].document).toBe(p.book!.chapters[0].document);
});
it("accepts a replacement without mutating or traversing its authored tree", () => {
  const p = fixture(),
    draft = createEditorDraft(p);
  const next = { type: "doc", content: [] };
  draft.project.book!.chapters[0].document = next;
  draft.project.book!.chapters[0].text = "";
  expect(draft.finish().book!.chapters[0].document).toBe(next);
  expect(p.book!.chapters[0].text).toBe("Original");
});
it("rejects nested writes, array edits, property definitions and deletes before touching shared data", () => {
  const p = fixture(),
    draft = createEditorDraft(p),
    doc = draft.project.book!.chapters[0].document;
  expect(() => {
    doc.content![0].content![0].text = "Changed";
  }).toThrow("replace document");
  expect(() => doc.content!.push({ type: "paragraph" })).toThrow(
    "replace document",
  );
  expect(() => Object.defineProperty(doc, "type", { value: "other" })).toThrow(
    "replace document",
  );
  expect(() => {
    delete doc.content;
  }).toThrow("replace document");
  expect(p.book!.chapters[0].document.content![0].content![0].text).toBe(
    "Original",
  );
});
it("unwraps moved document references before saving", () => {
  const p = fixture(),
    draft = createEditorDraft(p);
  draft.project.book!.chapters.push({
    ...draft.project.book!.chapters[0],
    id: "b",
  });
  const saved = draft.finish();
  expect(() => structuredClone(saved)).not.toThrow();
  expect(saved.book!.chapters[1].document).toBe(p.book!.chapters[0].document);
});

it("unwraps old nodes used to compose a new document", () => {
  const p = fixture(),
    draft = createEditorDraft(p);
  const previous = draft.project.book!.chapters[0].document;
  draft.project.book!.chapters[0].document = {
    type: "doc",
    content: [...previous.content!, { type: "paragraph" }],
  };
  const result = draft.finish();
  expect(() => structuredClone(result)).not.toThrow();
  expect(result.book!.chapters[0].document.content![0]).toBe(
    p.book!.chapters[0].document.content![0],
  );
});
