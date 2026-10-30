import type { Chapter } from "./types";

export type BookMatter = "frontmatter" | "bodymatter" | "backmatter";
export const chapterRoles = [
  ["titlepage", "Title page", "frontmatter"],
  ["copyright-page", "Copyright page", "frontmatter"],
  ["dedication", "Dedication", "frontmatter"],
  ["foreword", "Foreword", "frontmatter"],
  ["preface", "Preface", "frontmatter"],
  ["toc", "Contents", "frontmatter"],
  ["introduction", "Introduction", "bodymatter"],
  ["part", "Part", "bodymatter"],
  ["chapter", "Chapter", "bodymatter"],
  ["epilogue", "Epilogue", "bodymatter"],
  ["afterword", "Afterword", "backmatter"],
  ["appendix", "Appendix", "backmatter"],
  ["acknowledgments", "Acknowledgments", "backmatter"],
  ["bibliography", "Bibliography", "backmatter"],
  ["glossary", "Glossary", "backmatter"],
  ["index", "Index", "backmatter"],
  ["frontmatter", "Other front matter", "frontmatter"],
  ["backmatter", "Other back matter", "backmatter"],
] as const;
export const matterLabels: Record<BookMatter, string> = {
  frontmatter: "Front matter",
  bodymatter: "Body",
  backmatter: "Back matter",
};
export function chapterMatter(
  chapter: Pick<Chapter, "role" | "matter">,
): BookMatter {
  return (
    chapter.matter ||
    chapterRoles.find(([role]) => role === chapter.role)?.[2] ||
    "bodymatter"
  );
}
export function chapterRoleLabel(role: string) {
  return chapterRoles.find(([value]) => value === role)?.[1] || role;
}
/** New matter joins its existing group. Changing an existing chapter's role
 * never silently reorders authored material. */
export function insertStructuredChapter(chapters: Chapter[], chapter: Chapter) {
  const matter = chapterMatter(chapter);
  const at = chapters.findIndex((item) =>
    matter === "frontmatter"
      ? chapterMatter(item) !== "frontmatter"
      : matter === "bodymatter" && chapterMatter(item) === "backmatter",
  );
  chapters.splice(at < 0 ? chapters.length : at, 0, chapter);
}
