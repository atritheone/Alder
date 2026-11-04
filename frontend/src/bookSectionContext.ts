import type { DocNode, Project } from "./types";
import type { PageSettings } from "./pageGeometry";
import type { PageNumberFormat } from "./pageNumbering";

type SectionEvent = {
  page: PageSettings;
  numberingFormat?: PageNumberFormat | null;
};
const events = new WeakMap<DocNode, SectionEvent[]>();

/** Chapter boundaries are not section boundaries. Only included, preceding
 * chapters contribute. Cache structural events, never traverse prose on a key. */
export function chapterSectionContext(project: Project, chapterId: string) {
  let page: PageSettings | undefined;
  let pageNumberFormat = project.settings.pageNumberFormat;
  const chapters = project.book?.chapters || [];
  const target = chapters.findIndex((chapter) => chapter.id === chapterId);
  if (target < 0 || chapters[target].include === false)
    return { page, pageNumberFormat };
  for (let index = 0; index < target; index++) {
    const chapter = chapters[index];
    if (chapter.include === false) continue;
    let sections = events.get(chapter.document);
    if (!sections) {
      sections = (chapter.document.content || [])
        .filter((node) => node.type === "section_break")
        .map((node) => ({
          page: node.attrs?.page || {},
          numberingFormat: node.attrs?.numberingFormat,
        }));
      events.set(chapter.document, sections);
    }
    for (const section of sections) {
      // Section page settings are complete, not a patch on the previous sheet.
      page = section.page;
      pageNumberFormat = section.numberingFormat ?? pageNumberFormat;
    }
  }
  return { page, pageNumberFormat };
}
