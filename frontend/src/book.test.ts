import { describe, expect, it } from "vitest";
import { migrateBook } from "./book";
import { newClip, textDoc } from "./api";
import { schema } from "./Editor";
import { rearrangePages } from "./pageFlow";
import { documentText } from "./textProjection";
import type { Project } from "./types";

describe("book migration and page movement", () => {
  it("resolves frozen and selected wording in reading order and retains originals", () => {
    const clip = newClip("track", 0, "Original");
    clip.variants.push({
      id: "alternative",
      name: "Alternative",
      text: "Chosen",
      document: textDoc("Chosen"),
      createdAt: "",
    });
    clip.activeVariantId = "alternative";
    const project = {
      settings: {},
      clips: [clip],
      sections: [{ id: "section", title: "One", order: 0, role: "chapter" }],
      placements: [
        {
          id: "a",
          clipId: clip.id,
          sectionId: "section",
          order: 1,
          include: true,
          frozenDocument: null,
        },
        {
          id: "b",
          clipId: clip.id,
          sectionId: "section",
          order: 0,
          include: true,
          frozenDocument: textDoc("Frozen"),
        },
        {
          id: "c",
          clipId: clip.id,
          sectionId: "section",
          order: 2,
          include: false,
          frozenDocument: textDoc("Private"),
        },
      ],
    } as unknown as Project;
    const before = JSON.stringify(project),
      converted = migrateBook(project);
    expect(converted.book?.chapters[0].text).toBe("Frozen\nChosen");
    expect(JSON.stringify(project)).toBe(before);
    expect(migrateBook(converted)).toBe(converted);
  });
  it("moves rich paragraphs without losing marks or Unicode and refuses stale boundaries", () => {
    const a = schema.nodes.paragraph.create(
      null,
      schema.text("Alpha 😀", [schema.marks.strong.create()]),
    );
    const b = schema.nodes.paragraph.create(
      null,
      schema.text("Beta", [schema.marks.em.create()]),
    );
    const doc = schema.nodes.doc.create(null, [a, b]);
    const pages = [
      { from: 0, to: a.nodeSize, text: "Alpha 😀" },
      { from: a.nodeSize, to: doc.content.size, text: "Beta" },
    ];
    const moved = rearrangePages(doc, pages, 0, 1);
    expect(moved.child(0).eq(b)).toBe(true);
    expect(moved.child(2).eq(a)).toBe(true);
    expect(() =>
      rearrangePages(doc, [{ ...pages[0], to: 2 }, pages[1]], 0, 1),
    ).toThrow(/layout changed/);
    expect(documentText(moved.toJSON())).toContain("Alpha 😀");
  });
});
