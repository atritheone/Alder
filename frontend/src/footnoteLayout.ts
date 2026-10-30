import type { EditorView, DecorationSet } from "prosemirror-view";
import type { FlowPage, PageLayout } from "./pageFlow";
import { paginateColumns } from "./columnLayout";
import { pageInsets } from "./pageGeometry";
import { pageFrame } from "./sectionLayout";
import { physicalPageAtPosition } from "./pageRanges";

export type NoteLine = {
  html: string;
  height: number;
  repeat?: NoteLine[];
  keepWithNext?: boolean;
  sourceFrom?: number;
};
export function noteLineRequirement(lines: NoteLine[], at: number) {
  let height = lines[at].height;
  while (lines[at].keepWithNext && at + 1 < lines.length)
    height += lines[++at].height;
  return height;
}
export type MeasuredFootnote = {
  id: string;
  pos: number;
  lines: NoteLine[];
  anchorBottom?: number;
  width?: number;
  maximum?: number;
  measure?: (width:number, maximum:number, from:number, continued:boolean)=>NoteLine[];
};
export type FootnoteFragment = {
  id: string;
  continued: boolean;
  lines: NoteLine[];
};
export type FootnoteAllocation = {
  reserves: number[];
  fragments: FootnoteFragment[][];
  minimums: { pos: number; page: number }[];
};
const separator = 14;
const settledLayouts = new WeakMap<
  EditorView,
  {
    doc: import("prosemirror-model").Node;
    key: string;
    measured: MeasuredFootnote[];
    pages: FlowPage[];
    notes: FootnoteAllocation;
  }
>();

/** Reserve complete measured lines. Carry-over precedes new anchors. A new
 * note must start on its anchor's page, so a crowded anchor moves forward. */
export function allocateFootnotes(
  notes: MeasuredFootnote[],
  pages: FlowPage[],
  layout: PageLayout,
  minimums: Map<number, number> = new Map(),
): FootnoteAllocation {
  const pending = notes.map((note) => ({
    ...note,
    page: Math.max(
      minimums.get(note.pos) || 0,
      physicalPageAtPosition(pages, note.pos) || 0,
    ),
    line: 0,
    emitted:false,
    measuredPage: physicalPageAtPosition(pages, note.pos) || 0,
  }));
  const reserves: number[] = [],
    fragments: FootnoteFragment[][] = [];
  let at = 0,
    page = pending[0]?.page || 0;
  while (at < pending.length) {
    const current = pageFrame(
      pages,
      Math.min(page, pages.length - 1),
      layout,
    ).layout;
    const inset = pageInsets(current),
      body = current.height - inset.top - inset.bottom;
    // Leave room for at least two body lines, including the reference line.
    const maximum = body - Math.max(36, (layout.lineHeight || 1.5) * 32);
    let capacity = maximum;
    if (capacity <= separator)
      throw new Error(
        "The page is too short for a footnote and its reference line.",
      );
    let used = separator;
    const pieces: FootnoteFragment[] = [];
    while (at < pending.length && pending[at].page <= page) {
      const note = pending[at],width=current.width-inset.left-inset.right;
      if(note.measure && (note.width!==width || note.maximum!==maximum-separator)){
        const from=note.emitted?note.lines[note.line]?.sourceFrom:0;
        if(from==null)throw new Error('A rich footnote cannot continue across different page widths yet. Keep the section text widths equal before publishing.');
        note.lines=note.measure(width,maximum-separator,from,note.emitted);note.line=0;note.width=width;note.maximum=maximum-separator;
      }
      const first = note.line;
      if (!note.emitted && first === 0 && note.page < page)
        minimums.set(note.pos, Math.max(minimums.get(note.pos) || 0, page));
      if (
        note.lines.some(
          (line) =>
            !Number.isFinite(line.height) ||
            line.height <= 0 ||
            line.height + separator > maximum,
        )
      )
        throw new Error(
          "A footnote line is taller than the available page. Reduce its text size or increase the page height.",
        );
      if (
        !note.emitted && first === 0 &&
        note.measuredPage === page &&
        note.anchorBottom != null
      ) {
        const available = Math.min(capacity, body - note.anchorBottom);
        if (used + (note.lines[0]?.height || 0) > available) {
          note.page = page + 1;
          minimums.set(
            note.pos,
            Math.max(minimums.get(note.pos) || 0, page + 1),
          );
          break;
        }
        capacity = available;
      }
      const repeat = first > 0 ? note.lines[first]?.repeat || [] : [],
        repeatHeight = repeat.reduce((sum, line) => sum + line.height, 0);
      if (
        repeatHeight + noteLineRequirement(note.lines, first) + separator >
        maximum
      )
        throw new Error(
          "A note table heading and its following line are taller than the available page. Reduce the heading height or increase the page height.",
        );
      if (
        used + repeatHeight + noteLineRequirement(note.lines, first) <=
        capacity + 0.01
      )
        used += repeatHeight;
      else break;
      while (
        note.line < note.lines.length &&
        used + noteLineRequirement(note.lines, note.line) <= capacity + 0.01
      )
        used += note.lines[note.line++].height;
      if (note.line > first)
        pieces.push({
          id: note.id,
          continued: note.emitted || first > 0,
          lines: [...repeat, ...note.lines.slice(first, note.line)],
        });
      if(note.line>first)note.emitted=true;
      if (note.line === note.lines.length) {
        at++;
        continue;
      }
      if (!note.emitted && note.line === 0) {
        note.page = page + 1;
        minimums.set(note.pos, Math.max(minimums.get(note.pos) || 0, page + 1));
      }
      break;
    }
    if (pieces.length) {
      fragments[page] = pieces;
      reserves[page] = used;
    }
    page = Math.max(page + 1, pending[at]?.page || 0);
  }
  return {
    reserves,
    fragments,
    minimums: [...minimums]
      .map(([pos, page]) => ({ pos, page }))
      .sort((a, b) => a.pos - b.pos),
  };
}

/** The body and the note bank converge together. Once a reference line has to
 * move, releasing its old reservation must not pull it back and oscillate. */
export function paginateFootnotes(
  view: EditorView,
  layout: PageLayout,
  apply: (decorations: DecorationSet) => void,
  notes: MeasuredFootnote[],
  invalidate = false,
  trace?: (pages: FlowPage[]) => void,
) {
  const key = JSON.stringify({ ...layout, zoom: 1 }),
    previousLayout = settledLayouts.get(view),
    difference = previousLayout?.doc.content.findDiffStart(
      view.state.doc.content,
    );
  // Typing after the last reference cannot alter earlier note wording or
  // numbering. Reuse its settled reservations, then verify the anchor pages.
  // A keep-together change that moves an anchor falls back to full settlement.
  if (
    previousLayout?.key === key &&
    previousLayout.measured.length === notes.length &&
    (difference == null || difference > (notes.at(-1)?.pos ?? -1)) &&
    notes.every(
      (note, index) =>
        note.id === previousLayout.measured[index].id &&
        note.pos === previousLayout.measured[index].pos &&
        note.lines === previousLayout.measured[index].lines,
    )
  ) {
    const pages = paginateColumns(
      view,
      {
        ...layout,
        pageReserves: previousLayout.notes.reserves,
        pageMinimums: previousLayout.notes.minimums,
      },
      apply,
      invalidate,
    );
    if (
      notes.every(
        (note) =>
          physicalPageAtPosition(pages, note.pos) ===
          physicalPageAtPosition(previousLayout.pages, note.pos),
      ) && previousLayout.notes.fragments.every((fragment,index)=>!fragment?.length || JSON.stringify(pageFrame(pages,Math.min(index,pages.length-1),layout).layout)===JSON.stringify(pageFrame(previousLayout.pages,index,layout).layout))
    ) {
      const result = {
        pages: appendNotePages(view, pages, previousLayout.notes, layout),
        notes: previousLayout.notes,
      };
      settledLayouts.set(view, {
        ...previousLayout,
        doc: view.state.doc,
        pages: result.pages,
      });
      return result;
    }
  }
  let pages = paginateColumns(view, layout, apply, invalidate);
  if (!notes.length)
    return {
      pages,
      notes: {
        reserves: [],
        fragments: [],
        minimums: [],
      } as FootnoteAllocation,
    };
  const minimums = new Map<number, number>();
  let result: FootnoteAllocation | undefined;
  // Settle earlier anchors before reserving later notes. Otherwise a late note
  // can reserve pages that its own reference has not reached yet, pushing that
  // reference past phantom continuation pages.
  for (let count = 1; count <= notes.length; count++) {
    let previous = "",
      settled = false;
    const prefix = notes.slice(0, count);
    for (let pass = 0; pass < 64; pass++) {
      trace?.(pages);
      for (const note of prefix) {
        const actual = physicalPageAtPosition(pages, note.pos) || 0;
        minimums.set(note.pos, Math.max(minimums.get(note.pos) || 0, actual));
      }
      const canvas = view.dom.closest<HTMLElement>(".flow-canvas")!;
      const origin = canvas.getBoundingClientRect();
      const scale = origin.width / parseFloat(canvas.style.width);
      const measured = prefix.map((note) => {
        const page = physicalPageAtPosition(pages, note.pos) || 0;
        const frame = pageFrame(pages, page, layout);
        const before = view.coordsAtPos(note.pos, -1),
          after = view.coordsAtPos(
            Math.min(view.state.doc.content.size, note.pos + 1),
            -1,
          );
        return {
          ...note,
          anchorBottom:
            (Math.max(before.bottom, after.bottom) - origin.top) / scale -
            frame.top -
            pageInsets(frame.layout).top +
            4,
        };
      });
      result = allocateFootnotes(measured, pages, layout, minimums);
      const signature = JSON.stringify([
        result.reserves,
        result.minimums,
        pages.map((page) => [page.from, page.to, page.fragments]),
      ]);
      if (signature === previous) {
        settled = true;
        break;
      }
      previous = signature;
      pages = paginateColumns(
        view,
        {
          ...layout,
          pageReserves: result.reserves,
          pageMinimums: result.minimums,
        },
        apply,
        true,
      );
    }
    if (!settled)
      throw new Error(
        "Footnote layout did not settle. The original document is unchanged.",
      );
  }
  pages = appendNotePages(view, pages, result!, layout);
  settledLayouts.set(view, {
    doc: view.state.doc,
    key,
    measured: notes,
    pages,
    notes: result!,
  });
  return { pages, notes: result! };
}

function appendNotePages(
  view: EditorView,
  source: FlowPage[],
  notes: FootnoteAllocation,
  layout: PageLayout,
) {
  const pages = [...source];
  while (pages.length < notes.fragments.length) {
    const last = pageFrame(pages, pages.length - 1, layout);
    pages.push({
      from: view.state.doc.content.size,
      to: view.state.doc.content.size,
      text: "",
      frame: { ...last, top: last.top + last.layout.height + 28 },
    });
  }
  return pages;
}

export function footnoteHTML(
  fragments: FootnoteFragment[],
  layout: PageLayout,
  reserve: number,
  top?: number,
) {
  if (!fragments?.length) return "";
  const inset = pageInsets(layout);
  const escape = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `<div data-footnotes="true" style="position:absolute;left:${inset.left}px;right:${inset.right}px;${top == null ? `bottom:${inset.bottom}px` : `top:${Math.min(top, layout.height - inset.bottom - reserve)}px`};height:${reserve}px;font-size:9pt;line-height:1.2;color:#111"><div aria-hidden="true" style="height:${separator}px;box-sizing:border-box;border-top:1px solid currentColor;width:25%"></div>${fragments.map((fragment) => `<div data-note-fragment="${escape(fragment.id)}" data-note-continued="${fragment.continued}">${fragment.lines.map((line) => `<div style="height:${line.height}px;white-space:pre;overflow:visible">${line.html}</div>`).join("")}</div>`).join("")}</div>`;
}
