import type { DocNode, Project } from "./types";
import type { PageSettings } from "./pageGeometry";
import type { PageNumberFormat } from "./pageNumbering";
import { defaultRunningMatter, type RunningMatter } from "./runningMatter";

type SectionEvent = {
  page: PageSettings;
  numberingFormat?: PageNumberFormat | null;
};
const events = new WeakMap<DocNode, SectionEvent[]>();

/** Whole-document scope includes sections in every chapter, without altering
 * their numbering, break types, headers or other section metadata. */
export function changeDocumentPageSettings(project: Project, patch: PageSettings) {
  Object.assign(project.settings, patch);
  for (const chapter of project.book?.chapters || [])
    for (const node of chapter.document.content || [])
      if (node.type === "section_break")
        node.attrs = {...node.attrs, page: {...node.attrs?.page, ...patch}};
}

/** Edit the actual section supplying the start of a chapter, including a
 * section that begins in an earlier chapter. Call inside the project change. */
export function changeChapterPageSettings(project: Project, chapterId: string, patch: PageSettings) {
  let source: DocNode | undefined;
  for (const chapter of project.book?.chapters || []) {
    if (chapter.id === chapterId) break;
    if (chapter.include === false) continue;
    for (const node of chapter.document.content || []) if (node.type === "section_break") source = node;
  }
  if (source) source.attrs = {...source.attrs, page: {...source.attrs?.page, ...patch}};
  else Object.assign(project.settings, patch);
}

export function changeChapterRunningMatter(project: Project, chapterId: string, patch: RunningMatter) {
  let source: DocNode | undefined;
  for (const chapter of project.book?.chapters || []) {
    if (chapter.id === chapterId) break;
    if (chapter.include === false) continue;
    for (const node of chapter.document.content || []) if (node.type === "section_break") source = node;
  }
  if (source) source.attrs = {...source.attrs,runningMatter:{...source.attrs?.runningMatter,...patch}};
  else project.settings.runningMatter = {...defaultRunningMatter(project.settings),...patch};
}

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
