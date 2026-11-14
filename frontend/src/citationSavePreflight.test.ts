import { expect, it } from "vitest";
import { projectHasCitations } from "./documentCitations";
import type { DocNode, Project } from "./types";

it("finds fields in chapters, excluded chapters, drafts and variants without changing the project", () => {
  const plain: DocNode = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "The word bibliography is plain text." },
        ],
      },
    ],
  };
  const field: DocNode = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "citation" }] }],
  };
  const bibliography: DocNode = {
    type: "doc",
    content: [{ type: "bibliography" }],
  };
  const project = {
    book: { chapters: [{ document: plain }] },
    clips: [{ document: plain, variants: [{ document: plain }] }],
  } as Project;
  const before = JSON.stringify(project);
  expect(projectHasCitations(project)).toBe(false);
  expect(JSON.stringify(project)).toBe(before);
  for (const at of ["chapter", "excluded", "draft", "variant"]) {
    const next = structuredClone(project);
    if (at === "chapter") next.book!.chapters[0].document = field;
    if (at === "excluded")
      next.book!.chapters.push({
        include: false,
        document: bibliography,
      } as any);
    if (at === "draft") next.clips[0].document = field;
    if (at === "variant") next.clips[0].variants[0].document = bibliography;
    expect(projectHasCitations(next)).toBe(true);
  }
});
