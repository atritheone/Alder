// @vitest-environment jsdom
import { it, expect } from "vitest";
import { newChapter } from "./book";
import { resolveBookReview } from "./bookReview";
import { schema } from "./Editor";
import { ProjectTimeline } from "./projectTimeline";
import type { Project } from "./types";
const fixture = () => {
  const chapters = ["First", "Second", "Untouched"].map((title, i) => ({
    ...newChapter(title, {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { blockId: title },
          content: [
            {
              type: "text",
              text: title,
              ...(i < 2
                ? {
                    marks: [
                      {
                        type: "revision_insertion",
                        attrs: {
                          id: title,
                          author: i ? "Bob" : "Alice",
                          date: "2026-11-03T00:00:00Z",
                        },
                      },
                    ],
                  }
                : {}),
            },
          ],
        },
      ],
    }),
    id: title,
    include: i !== 1,
  }));
  return {
    id: "project",
    revision: 1,
    name: "Book",
    book: { version: 1, chapters },
    settings: {},
    clips: [],
  } as unknown as Project;
};
const snapshots = (p: Project) =>
  p.book!.chapters.map((c) => ({
    id: c.id,
    title: c.title,
    document: structuredClone(c.document),
  }));
it("reviews selected changes across included and excluded chapters in one undoable project change", () => {
  const before = fixture(),
    after = structuredClone(before),
    sources = snapshots(before);
  resolveBookReview(after, sources, new Set(["First", "Second"]), "reject");
  expect(after.book!.chapters.map((c) => c.text)).toEqual([
    "",
    "",
    "Untouched",
  ]);
  expect(after.book!.chapters[1].include).toBe(false);
  expect(after.book!.chapters[2]).toEqual(before.book!.chapters[2]);
  const timeline = new ProjectTimeline();
  timeline.record(before, after);
  expect(timeline.step(after, "undo")!.project.book).toEqual(before.book);
});
it("rejects stale later wording and formatting before changing any chapter", () => {
  for (const field of ["text", "format"] as const) {
    const p = fixture(),
      sources = snapshots(p);
    const node = p.book!.chapters[1].document.content![0];
    if (field === "text") node.content![0].text = "Changed";
    else node.attrs!.align = "right";
    const before = structuredClone(p);
    expect(() =>
      resolveBookReview(p, sources, new Set(["First", "Second"]), "accept"),
    ).toThrow("book changed");
    expect(p).toEqual(before);
  }
});
it("accepts an equivalent live editor snapshot with schema defaults", () => {
  const p = fixture(),
    sources = snapshots(p);
  sources[0].document = schema.nodeFromJSON(sources[0].document).toJSON();
  resolveBookReview(p, sources, new Set(["First"]), "accept");
  expect(
    p.book!.chapters[0].document.content![0].content![0].marks,
  ).toBeUndefined();
  expect(p.book!.chapters[1].document).toEqual(sources[1].document);
});
it("refuses disappeared changes or changed chapter structure atomically", () => {
  const p = fixture(),
    sources = snapshots(p),
    before = structuredClone(p);
  expect(() =>
    resolveBookReview(p, sources, new Set(["First", "missing"]), "accept"),
  ).toThrow("no longer");
  expect(p).toEqual(before);
  expect(() =>
    resolveBookReview(p, sources.slice(0, 2), new Set(["First"]), "accept"),
  ).toThrow("structure");
  expect(p).toEqual(before);
});
