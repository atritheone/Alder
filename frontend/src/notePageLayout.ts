import type { EditorView, DecorationSet } from "prosemirror-view";
import { documentNotes, assignPageNoteNumbers } from "./documentNotes";
import {
  paginateFootnotes,
  footnoteHTML,
  noteLineRequirement,
} from "./footnoteLayout";
import { measureNoteLines } from "./noteStoryLayout";
import { pageFrame } from "./sectionLayout";
import { pageInsets } from "./pageGeometry";
import { paginateColumns } from "./columnLayout";
import type { PageLayout, FlowPage } from "./pageFlow";
import { physicalPageAtPosition } from "./pageRanges";
import { mirroredPageLayout } from "./mirroredMargins";
import { pageRanges } from "./pageRanges";

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
  let baseline = paginateColumns(view, layout, apply, invalidate);
  let result: ReturnType<typeof paginateFootnotes> | undefined;
  const overflowingRows = new Set<string>();
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
    const measured = entries
      .filter((note) => note.value.kind === "footnote")
      .map((note) => {
        const frame = pageFrame(
            baseline,
            physicalPageAtPosition(baseline, note.pos) || 0,
            layout,
          ),
          inset = pageInsets(frame.layout);
        const width=frame.layout.width-inset.left-inset.right,
          maximum=frame.layout.height-inset.top-inset.bottom-Math.max(36,(layout.lineHeight||1.5)*32)-14;
        const measure=(width:number,maximum:number,from:number,continued=false)=>{
          const lines=measureNoteLines(note.value.body,note.number,width,layout.fontFamily||'Cambria',view.state.schema,layout.runningStyles,maximum,from,continued);
          lines.overflowingRows?.forEach(id=>overflowingRows.add(id));
          return lines;
        };
        return { ...note, lines:measure(width,maximum,0),width,maximum,measure };
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
    noteHTML: footnoteHTML(
      result.notes.fragments[index],
      mirroredPageLayout(pageFrame(result.pages, index, layout).layout, index),
      result.notes.reserves[index],
      noteSettings.get(result.notes.fragments[index]?.at(-1)?.id || "")
        ?.footnote.placement === "beneathText"
        ? bodyBottom(page, index)
        : undefined,
    ),
  }));
  // Endnotes use the final section's page width, even when their references
  // belong to an earlier section with different paper geometry.
  const final = pageFrame(pages, pages.length - 1, layout).layout,
    finalInsets = pageInsets(final);
  const endnotes = entries
    .filter((note) => note.value.kind === "endnote")
    .map((note) => {
      const lines = measureNoteLines(
        note.value.body,
        note.number,
        final.width - finalInsets.left - finalInsets.right,
        layout.fontFamily || "Cambria",
        view.state.schema,
        layout.runningStyles,
        final.height - finalInsets.top - finalInsets.bottom - 14,
      );
      lines.overflowingRows?.forEach((id) => overflowingRows.add(id));
      return { ...note, lines };
    });
  const escape = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  // Endnotes follow the final body line in the available text area; they do
  // not require an extra sheet. Leave the settled footnote bank untouched.
  let index = pages.length - 1;
  while (
    index > 0 &&
    !pageRanges(pages[index]).some((range) => range.to > range.from)
  )
    index--;
  let current: FlowPage = pages[index],
    used = bodyBottom(current, index) - finalInsets.top,
    separator = true;
  const banks = new Map<number, string>();
  for (const note of endnotes) {
    for (let lineIndex = 0; lineIndex < note.lines.length; lineIndex++) {
      const line = note.lines[lineIndex],
        required = noteLineRequirement(note.lines, lineIndex);
      const last = pageFrame(pages, index, layout),
        height = last.layout.height - finalInsets.top - finalInsets.bottom;
      if (
        required +
          (line.repeat || []).reduce((sum, line) => sum + line.height, 0) +
          14 >
        height
      )
        throw new Error(
          "An endnote line is taller than its page. Reduce its text size or increase the page height.",
        );
      while (
        used +
          required +
          (separator
            ? 14 +
              (line.repeat || []).reduce((sum, line) => sum + line.height, 0)
            : 0) >
        height - (result.notes.reserves[index] || 0)
      ) {
        if (index + 1 === pages.length) {
          const previous = pageFrame(pages, index, layout);
          pages.push({
            from: view.state.doc.content.size,
            to: view.state.doc.content.size,
            text: "",
            frame: {
              ...previous,
              top: previous.top + previous.layout.height + 28,
            },
            noteHTML: "",
          });
        }
        index++;
        current = pages[index];
        used = 0;
        separator = true;
      }
      const inset = pageInsets(
        mirroredPageLayout(pageFrame(pages, index, layout).layout, index),
      );
      let html = banks.get(index) || "";
      if (separator) {
        html += `<div aria-hidden="true" style="position:absolute;left:${inset.left}px;top:${inset.top + used}px;width:${(final.width - inset.left - inset.right) / 4}px;border-top:1px solid #111"></div>`;
        used += 14;
        separator = false;
        for (const header of line.repeat || []) {
          html += `<div style="position:absolute;left:${inset.left}px;right:${inset.right}px;top:${inset.top + used}px;height:${header.height}px">${header.html}</div>`;
          used += header.height;
        }
      }
      html += `<div data-note-fragment="${escape(note.id)}" style="position:absolute;left:${inset.left}px;right:${inset.right}px;top:${inset.top + used}px;height:${line.height}px;font-size:9pt;line-height:1.2;color:#111">${line.html}</div>`;
      banks.set(index, html);
      used += line.height;
      const fragments = result.notes.fragments[index];
      if (
        noteSettings.get(fragments?.at(-1)?.id || "")?.footnote.placement ===
        "beneathText"
      )
        current.noteHTML = footnoteHTML(
          fragments,
          mirroredPageLayout(pageFrame(pages, index, layout).layout, index),
          result.notes.reserves[index],
          inset.top + used + 4,
        );
    }
  }
  for (const [index, html] of banks)
    pages[index].noteHTML = html + pages[index].noteHTML;
  pages[0].overflowingNoteRows = [...overflowingRows];
  return pages;
}
