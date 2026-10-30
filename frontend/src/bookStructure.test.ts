import { describe, it, expect } from "vitest";
import { newChapter } from "./book";
import { chapterMatter, insertStructuredChapter } from "./bookStructure";
describe("structured book matter", () => {
  it("inserts new divisions without sorting or renumbering existing chapters", () => {
    const body = newChapter("One"),
      back = { ...newChapter("Index"), role: "index" },
      front = { ...newChapter("Preface"), role: "preface" };
    const chapters = [body, back];
    insertStructuredChapter(chapters, front);
    const next = newChapter("Two");
    insertStructuredChapter(chapters, next);
    expect(chapters).toEqual([front, body, next, back]);
    const end = { ...newChapter("Appendix"), role: "appendix" };
    insertStructuredChapter(chapters, end);
    expect(chapters.at(-1)).toBe(end);
    expect(chapterMatter({ role: "introduction", matter: "frontmatter" })).toBe(
      "frontmatter",
    );
    expect(chapterMatter({ role: "Legacy custom section" })).toBe("bodymatter");
  });
});
