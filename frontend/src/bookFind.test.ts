import { describe, expect, it } from "vitest";
import { newChapter } from "./book";
import { replaceBookMatches } from "./bookFind";
import { findText } from "./findText";
import type { Project } from "./types";

const fixture = () => {
  const chapters = ["First", "Second", "Untouched"].map((title, index) => ({
    ...newChapter(title, {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { blockId: title, align: "right" },
          content: [
            {
              type: "text",
              text: index === 2 ? "Other text" : "cat and cat",
              marks: [{ type: "em" }],
            },
          ],
        },
      ],
    }),
    id: title,
    include: index !== 1,
  }));
  const project = { book: { chapters } } as Project;
  const groups = chapters.slice(0, 2).map((chapter) => ({
    id: chapter.id,
    text: chapter.text,
    matches: findText(chapter.text, "cat", {
      wholeWord: true,
      caseSensitive: false,
    }),
  }));
  return { project, groups };
};

describe("whole-book replacement", () => {
  it("preserves formatting and identities, including excluded chapters", () => {
    const { project, groups } = fixture();
    const untouched = structuredClone(project.book!.chapters[2]);
    replaceBookMatches(project, groups, "tiger");
    for (const chapter of project.book!.chapters.slice(0, 2)) {
      expect(chapter.text).toBe("tiger and tiger");
      const paragraph = chapter.document.content![0];
      expect(paragraph.attrs).toMatchObject({
        blockId: chapter.id,
        align: "right",
      });
      expect(paragraph.content![0].marks).toContainEqual({ type: "em" });
    }
    expect(project.book!.chapters[1].include).toBe(false);
    expect(project.book!.chapters[2]).toEqual(untouched);
  });
  it("rejects stale later chapters without changing any earlier chapter", () => {
    const { project, groups } = fixture();
    groups[1].text = "obsolete";
    const before = structuredClone(project);
    expect(() => replaceBookMatches(project, groups, "dog")).toThrow(
      "book changed",
    );
    expect(project).toEqual(before);
  });
  it("uses the previewed capture replacement for each book match", () => {
    const { project, groups } = fixture();
    for (const [chapter, group] of groups.entries())
      group.matches = group.matches.map((match, index) => ({
        ...match,
        replacement: `${chapter + 1}-${index + 1}`,
      }));
    replaceBookMatches(project, groups, "literal fallback");
    expect(project.book!.chapters[0].text).toBe("1-1 and 1-2");
    expect(project.book!.chapters[1].text).toBe("2-1 and 2-2");
  });
  it("rejects duplicate chapters and invalid or overlapping ranges atomically", () => {
    const { project, groups } = fixture();
    const before = structuredClone(project);
    expect(() =>
      replaceBookMatches(project, [groups[0], groups[0]], "dog"),
    ).toThrow("duplicate chapters");
    for (const matches of [
      [{ start: -1, end: 2 }],
      [{ start: 0, end: 99 }],
      [
        { start: 0, end: 3 },
        { start: 2, end: 4 },
      ],
    ]) {
      groups[1].matches = matches;
      expect(() => replaceBookMatches(project, groups, "dog")).toThrow(
        "search ranges",
      );
      expect(project).toEqual(before);
    }
  });
});
