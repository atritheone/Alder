import type { NoteLine } from "./footnoteLayout";
import type { PageLayout } from "./pageFlow";
import type { EditorView } from "prosemirror-view";
import { pageInsets } from "./pageGeometry";
import { sectionLayout } from "./sectionLayout";
import { columnMeasurement } from "./columns";
import { documentNotes } from "./documentNotes";
import { measureNoteLines } from "./noteStoryLayout";

export type EndnoteBank = {
  pos: number;
  notes: { id: string; lines: NoteLine[] }[];
};

/** All banks participate in body flow, including the last section in a
 * multi-column document. Only generated paint and spacing enter pagination. */
export function sectionEndnoteBanks(view: EditorView, layout: PageLayout) {
  const notes = documentNotes(
    view.state.doc,
    layout.noteStarts,
    layout.noteOptions,
  ).filter((note) => note.value.kind === "endnote");
  const banks: EndnoteBank[] = [],
    overflowingRows = new Set<string>(),
    emitted = new Set<string>();
  let section = 0,
    current = layout;
  const append = (pos: number, selected: typeof notes) => {
    const measured = columnMeasurement(current),
      inset = pageInsets(measured);
    if (!selected.length) return;
    banks.push({
      pos,
      notes: selected.map((note) => {
        emitted.add(note.id);
        const lines = measureNoteLines(
          note.value.body,
          note.number,
          measured.width - inset.left - inset.right,
          layout.fontFamily || "Cambria",
          view.state.schema,
          layout.runningStyles,
          measured.height - inset.top - inset.bottom - 14,
        );
        lines.overflowingRows?.forEach((id) => overflowingRows.add(id));
        return { id: note.id, lines };
      }),
    });
  };
  view.state.doc.forEach((node, pos) => {
    if (node.type.name !== "section_break") return;
    append(
      pos,
      notes.filter(
        (note) =>
          note.section === section &&
          note.options.endnote.placement === "sectEnd",
      ),
    );
    current = sectionLayout(current, node.attrs.page);
    section++;
  });
  append(
    view.state.doc.content.size,
    notes.filter((note) => !emitted.has(note.id)),
  );
  return { banks, overflowingRows };
}

/** Callbacks advance the same frames used by body pagination. Returned paint
 * is page-local; authored text positions and note bodies remain unchanged. */
export function flowEndnoteBank(
  bank: EndnoteBank,
  used: number,
  frame: () => { page: number; layout: PageLayout; reserve: number },
  advance: () => void,
) {
  const html = new Map<number, string>();
  const bottoms = new Map<number, number>();
  let separator = true;
  const escape = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  for (const note of bank.notes) {
    for (let at = 0; at < note.lines.length; at++) {
      const line = note.lines[at];
      let required = line.height;
      for (
        let next = at;
        note.lines[next].keepWithNext && next + 1 < note.lines.length;
      )
        required += note.lines[++next].height;
      const repeatHeight = (line.repeat || []).reduce(
        (sum, item) => sum + item.height,
        0,
      );
      const full = frame(),
        fullInset = pageInsets(full.layout),
        fullHeight = full.layout.height - fullInset.top - fullInset.bottom;
      if (
        !Number.isFinite(required) ||
        required <= 0 ||
        required + repeatHeight + 14 > fullHeight
      )
        throw new Error(
          "An endnote line is taller than its page. Reduce its text size or increase the page height.",
        );
      let attempts = 0;
      while (true) {
        const active = frame(),
          inset = pageInsets(active.layout);
        if (
          used + required + (separator ? 14 + repeatHeight : 0) <=
          active.layout.height -
            inset.top -
            inset.bottom -
            active.reserve +
            0.01
        )
          break;
        if (++attempts > 10000)
          throw new Error(
            "Endnote layout could not find available page space.",
          );
        advance();
        used = 0;
        separator = true;
      }
      const active = frame(),
        inset = pageInsets(active.layout);
      let paint = html.get(active.page) || "";
      const element = (item: NoteLine, content: string, attributes = "") =>
        `<div ${attributes} style="position:absolute;left:${inset.left}px;right:${inset.right}px;top:${inset.top + used}px;height:${item.height}px;font-size:9pt;line-height:1.2;color:#111">${content}</div>`;
      if (separator) {
        paint += `<div aria-hidden="true" style="position:absolute;left:${inset.left}px;top:${inset.top + used}px;width:${(active.layout.width - inset.left - inset.right) / 4}px;border-top:1px solid #111"></div>`;
        used += 14;
        separator = false;
        for (const header of line.repeat || []) {
          paint += element(header, header.html);
          used += header.height;
        }
      }
      paint += element(
        line,
        line.html,
        `data-note-fragment="${escape(note.id)}"`,
      );
      used += line.height;
      html.set(active.page, paint);
      bottoms.set(active.page, inset.top + used);
    }
  }
  return { used, html, bottoms };
}
