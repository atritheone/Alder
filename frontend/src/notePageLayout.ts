import type { EditorView, DecorationSet } from "prosemirror-view";
import { documentNotes, assignPageNoteNumbers } from "./documentNotes";
import { paginateFootnotes, footnoteHTML } from "./footnoteLayout";
import { measureNoteLines } from "./noteStoryLayout";
import { pageFrame } from "./sectionLayout";
import { pageInsets } from "./pageGeometry";
import { paginateColumns } from "./columnLayout";
import type { PageLayout, FlowPage } from "./pageFlow";
import { physicalPageAtPosition } from "./pageRanges";
import { mirroredPageLayout } from "./mirroredMargins";
import { pageRanges } from "./pageRanges";
import { sectionEndnoteBanks } from "./sectionEndnotes";
import type { NoteProgress } from "./noteProgress";

export function paginateDocumentNotes(
  view: EditorView,
  layout: PageLayout,
  apply: (decorations: DecorationSet) => void,
  invalidate = false,
): FlowPage[] {
  let entries = documentNotes(
    view.state.doc,
    layout.noteStarts,
    layout.noteOptions,
  );
  if (!entries.length) return paginateColumns(view, layout, apply, invalidate);
  const sectionNotes = sectionEndnoteBanks(view, layout);
  layout = { ...layout, sectionEndnotes: sectionNotes.banks };
  let baseline = paginateColumns(view, layout, apply, invalidate);
  let result: ReturnType<typeof paginateFootnotes> | undefined;
  const overflowingRows = new Set<string>(sectionNotes.overflowingRows);
  for (let attempt = 0; attempt < 12; attempt++) {
    if (
      assignPageNoteNumbers(
        view.state.doc,
        baseline,
        layout.noteStarts,
        layout.noteOptions,
      )
    )
      view.updateState(view.state);
    entries = documentNotes(
      view.state.doc,
      layout.noteStarts,
      layout.noteOptions,
    );
    overflowingRows.clear();
    sectionNotes.overflowingRows.forEach((id) => overflowingRows.add(id));
    const measured = entries
      .filter((note) => note.value.kind === "footnote")
      .map((note) => {
        const frame = pageFrame(
            baseline,
            physicalPageAtPosition(baseline, note.pos) || 0,
            layout,
          ),
          inset = pageInsets(frame.layout);
        const width = frame.layout.width - inset.left - inset.right,
          maximum =
            frame.layout.height -
            inset.top -
            inset.bottom -
            Math.max(36, (layout.lineHeight || 1.5) * 32) -
            14;
        const measure = (
          width: number,
          maximum: number,
          from: number,
          continued = false,
          images = 0,
          read?: NoteProgress,
        ) => {
          const lines = measureNoteLines(
            note.value.body,
            note.number,
            width,
            layout.fontFamily || "Cambria",
            view.state.schema,
            layout.runningStyles,
            maximum,
            from,
            continued,
            images,
            read,
          );
          lines.overflowingRows?.forEach((id) => overflowingRows.add(id));
          return lines;
        };
        return {
          ...note,
          lines: measure(width, maximum, 0),
          width,
          maximum,
          measure,
        };
      });
    result = paginateFootnotes(
      view,
      layout,
      apply,
      measured.filter((note) => note.value.kind === "footnote"),
      invalidate || attempt > 0,
    );
    if (
      !assignPageNoteNumbers(
        view.state.doc,
        result.pages,
        layout.noteStarts,
        layout.noteOptions,
      )
    )
      break;
    view.updateState(view.state);
    if (attempt === 11)
      throw new Error(
        "Footnote page numbering did not settle. The original document is unchanged.",
      );
    baseline = result.pages;
  }
  if (!result) throw new Error("Footnote layout is unavailable.");
  const canvas = view.dom.closest<HTMLElement>(".flow-canvas")!,
    origin = canvas.getBoundingClientRect(),
    scale = origin.width / parseFloat(canvas.style.width),
    noteSettings = new Map(entries.map((note) => [note.id, note.options]));
  const bodyBottom = (page: FlowPage, index: number) =>
    Math.max(
      page.endnoteBottom || 0,
      pageInsets(pageFrame(result!.pages, index, layout).layout).top,
      ...pageRanges(page)
        .filter((range) => range.to > range.from)
        .map(
          (range) =>
            (view.coordsAtPos(
              Math.min(view.state.doc.content.size, range.to - 1),
              -1,
            ).bottom -
              origin.top) /
              scale -
            pageFrame(result!.pages, index, layout).top +
            4,
        ),
    );
  const pages = result.pages.map((page, index) => ({
    ...page,
    noteHTML:
      (page.noteHTML || "") +
      footnoteHTML(
        result.notes.fragments[index],
        mirroredPageLayout(
          pageFrame(result.pages, index, layout).layout,
          index,
        ),
        result.notes.reserves[index],
        noteSettings.get(result.notes.fragments[index]?.at(-1)?.id || "")
          ?.footnote.placement === "beneathText"
          ? bodyBottom(page, index)
          : undefined,
      ),
  }));
  pages[0].overflowingNoteRows = [...overflowingRows];
  return pages;
}
