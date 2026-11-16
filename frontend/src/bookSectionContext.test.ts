import { describe, expect, it } from "vitest";
import { chapterSectionContext, changeChapterPageSettings, changeDocumentPageSettings, changeChapterRunningMatter } from "./bookSectionContext";
import { screenPageGeometry } from "./pageGeometry";
import { sectionLayout } from "./sectionLayout";
import type { DocNode, Project } from "./types";

const section = (page: object, numberingFormat?: string): DocNode => ({
  type: "section_break",
  attrs: { page, numberingFormat },
});
const fixture = (): Project =>
  ({
    settings: {
      pageSize: "A4",
      mirrorMargins: true,
      pageNumberFormat: "decimal",
    },
    book: {
      chapters: [
        {
          id: "a",
          include: true,
          document: {
            type: "doc",
            content: [
              section(
                {
                  pageSize: "A5",
                  orientation: "landscape",
                  marginMm: 15,
                  columns: { count: 2, gapMm: 8, separator: true },
                },
                "lowerRoman",
              ),
              {
                type: "paragraph",
                content: [{ type: "text", text: "First chapter." }],
              },
            ],
          },
        },
        {
          id: "excluded",
          include: false,
          document: {
            type: "doc",
            content: [section({ pageSize: "Legal" }, "upperLetter")],
          },
        },
        {
          id: "b",
          document: { type: "doc", content: [section({ pageSize: "Letter" })] },
        },
        { id: "c", document: { type: "doc", content: [] } },
      ],
    },
  }) as unknown as Project;

describe("chapter section context", () => {
  it("changes running distances without copying linked stories into the section", () => {
    const p=fixture();
    changeChapterRunningMatter(p,"b",{headerDistanceMm:8});
    expect(p.book!.chapters[0].document.content![0].attrs!.runningMatter).toEqual({headerDistanceMm:8});
    expect(p.book!.chapters[1].document.content![0].attrs!.runningMatter).toBeUndefined();
    changeChapterRunningMatter(p,"a",{footerDistanceMm:7});
    expect(p.settings.runningMatter!.footerDistanceMm).toBe(7);
  });
  it("applies document geometry across sections while retaining their other properties", () => {
    const p = fixture();
    changeDocumentPageSettings(p, {marginTopMm: 30, orientation: "portrait"});
    expect(p.settings.marginTopMm).toBe(30);
    for(const chapter of p.book!.chapters)
      for(const node of chapter.document.content || [])
        if(node.type === "section_break") {
          expect(node.attrs!.page.marginTopMm).toBe(30);
          expect(node.attrs!.page.orientation).toBe("portrait");
        }
    expect(p.book!.chapters[0].document.content![0].attrs!.numberingFormat).toBe("lowerRoman");
    expect(p.book!.chapters[0].document.content![0].attrs!.page.columns.count).toBe(2);
  });
  it("edits the supplying section rather than an excluded chapter or all document defaults", () => {
    const p=fixture();
    changeChapterPageSettings(p,"b",{marginTopMm:30});
    expect(p.book!.chapters[0].document.content![0].attrs!.page.marginTopMm).toBe(30);
    expect(p.book!.chapters[1].document.content![0].attrs!.page.marginTopMm).toBeUndefined();
    expect(p.settings.marginTopMm).toBeUndefined();
    changeChapterPageSettings(p,"a",{marginBottomMm:25});
    expect(p.settings.marginBottomMm).toBe(25);
  });
  it("inherits the preceding included section, without consuming the active chapter", () => {
    const p = fixture(),
      before = JSON.stringify(p);
    expect(chapterSectionContext(p, "b")).toEqual({
      page: p.book!.chapters[0].document.content![0].attrs!.page,
      pageNumberFormat: "lowerRoman",
    });
    expect(chapterSectionContext(p, "a")).toEqual({
      page: undefined,
      pageNumberFormat: "decimal",
    });
    expect(JSON.stringify(p)).toBe(before);
  });
  it("replaces section geometry, retains global mirrored margins and clears old columns", () => {
    const p = fixture(),
      context = chapterSectionContext(p, "c");
    const layout = sectionLayout(
      { ...screenPageGeometry(p.settings), lineHeight: 1.5, zoom: 1 },
      context.page!,
    );
    expect(layout.width).toBeCloseTo((215.9 * 96) / 25.4);
    expect(layout.height).toBeCloseTo((279.4 * 96) / 25.4);
    expect(layout.columns).toBeUndefined();
    expect(layout.mirrorMargins).toBe(true);
    expect(context.pageNumberFormat).toBe("lowerRoman");
  });
  it("isolates excluded chapters and invalidates immutable edits and reorderings", () => {
    const p = fixture();
    expect(chapterSectionContext(p, "excluded").page).toBeUndefined();
    expect(chapterSectionContext(p, "missing").page).toBeUndefined();
    chapterSectionContext(p, "b");
    p.book!.chapters[0].document = {
      type: "doc",
      content: [section({ pageSize: "6x9" }, "upperRoman")],
    };
    expect(chapterSectionContext(p, "b")).toMatchObject({
      page: { pageSize: "6x9" },
      pageNumberFormat: "upperRoman",
    });
    p.book!.chapters.unshift(p.book!.chapters.splice(2, 1)[0]);
    expect(chapterSectionContext(p, "b").page).toBeUndefined();
  });
});
