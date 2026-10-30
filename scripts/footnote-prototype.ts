// Test-only layout harness: no application route exposes this prototype.
import { EditorView, DecorationSet } from "prosemirror-view";
import { EditorState, Plugin, TextSelection } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { schema as mainSchema } from "../frontend/src/Editor";
import { Schema } from "prosemirror-model";
const schema = new Schema({
  nodes: mainSchema.spec.nodes.addToEnd("probe_note", {
    inline: true,
    atom: true,
    group: "inline",
    attrs: { name: { default: "" }, blockId: { default: null } },
    toDOM: (node) => ["sup", { "data-probe-note": node.attrs.name }, "1"],
  }),
  marks: mainSchema.spec.marks,
});
import {
  paginateFootnotes,
  footnoteHTML,
  type MeasuredFootnote,
} from "../frontend/src/footnoteLayout";
import { columnPlacementPlugin } from "../frontend/src/columnLayout";
import { horizontalPagePlacement } from "../frontend/src/mirroredMargins";
import {
  capturePagePublication,
  publicationHTML,
} from "../frontend/src/pagePublication";
import { pageFrame, pageCanvasHeight } from "../frontend/src/sectionLayout";
import { physicalPageAtPosition } from "../frontend/src/pageRanges";
import type { PageLayout } from "../frontend/src/pageFlow";
import { measureNoteLines } from "../frontend/src/noteStoryLayout";
import { paginateDocumentNotes } from "../frontend/src/notePageLayout";
import { documentNotes, noteNumbers } from "../frontend/src/documentNotes";
import { readingHighlight } from "../frontend/src/readingHighlight";
import { speechText, type ReadingRange } from "../frontend/src/speechText";
import { noteReadingRanges } from "../frontend/src/noteReading";
const shell = document.createElement("div");
shell.style.cssText =
  "position:fixed;inset:0;z-index:999999;overflow:auto;background:#bbb;padding:20px";
shell.dataset.alderEditor = "footnote-probe";
document.body.append(shell);
const canvas = document.createElement("div");
canvas.className = "flow-canvas";
canvas.style.cssText =
  "position:relative;width:420px;--page-width:420px;--page-height:400px;--page-margin:40px;--page-margin-top:40px;--page-margin-right:40px;--page-margin-bottom:40px;--page-margin-left:40px;--page-leading:1.5;--page-gap:28px";
shell.append(canvas);
const sheets = document.createElement("div");
sheets.className = "page-sheets";
canvas.append(sheets);
const host = document.createElement("div");
host.className = "page-flow";
canvas.append(host);
let decorations = DecorationSet.empty,
  result: ReturnType<typeof paginateFootnotes>,
  noteCounts: Record<string, number> = {};
const layout: PageLayout = {
  width: 420,
  height: 400,
  margin: 40,
  lineHeight: 1.5,
  zoom: 1,
  fontFamily: "Arial",
  footer: false,
};
let measuring = false;
const probeBodies = new Map<string, any>();
let realNotes = false,
  reading: ReadingRange | null = null,
  measurementMs = 0;
let trace: any[] = [];
const view = new EditorView(host, {
  state: EditorState.create({
    schema,
    plugins: [
      history(),
      new Plugin({ props: { decorations: () => decorations } }),
      horizontalPagePlacement(),
      columnPlacementPlugin(),
      noteNumbers(),
      readingHighlight(
        () => reading,
        () => true,
      ),
      keymap({ "Mod-z": undo }),
      keymap(baseKeymap),
    ],
  }),
  attributes: {
    role: "textbox",
    "aria-label": "Footnote body",
    style: "font:16px/24px Arial",
  },
  dispatchTransaction(tr) {
    view.updateState(view.state.apply(tr));
    if (tr.docChanged && !measuring) measure();
  },
});
function notes() {
  const values: MeasuredFootnote[] = [];
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === "probe_note" && noteCounts[node.attrs.name]) {
      const key=node.attrs.name+':'+noteCounts[node.attrs.name];
      if(!probeBodies.has(key)) probeBodies.set(key, {
        type:'doc',content:[{type:'paragraph',content:Array.from({length:noteCounts[node.attrs.name]},(_,i)=>[
          ...(i?[{type:'hard_break'}]:[]),{type:'text',text:`${node.attrs.name}_${String(i).padStart(3,'0')} Note line.`,...(i%3===0?{marks:[{type:'strong'}]}:{})}
        ]).flat()}]
      });
      values.push({
        id: node.attrs.name,
        pos,
        lines: measureNoteLines(
          probeBodies.get(key),
          node.attrs.name.replace("NOTE", ""),
          340,
          "Arial",
          schema,
        ),
      });
    }
  });
  return values;
}
function measure() {
  const began = performance.now();
  measuring = true;
  trace = [];
  try {
    if (realNotes)
      result = {
        pages: paginateDocumentNotes(
          view,
          layout,
          (next) => {
            decorations = next;
            view.updateState(view.state);
          },
          true,
        ),
        notes: { fragments: [], reserves: [], minimums: [] },
      };
    else
      result = paginateFootnotes(
        view,
        layout,
        (next) => {
          decorations = next;
          view.updateState(view.state);
        },
        notes(),
        true,
        (pages) =>
          trace.push({
            pages: pages.map((page) => [page.from, page.to]),
            notes: notes().map((note) => ({
              pos: note.pos,
              points: Array.from({ length: Math.min(note.pos, 4) }, (_, i) => {
                const pos = note.pos - i;
                return { pos, ...view.coordsAtPos(pos, 1) };
              }),
            })),
          }),
      );
    sheets.innerHTML = "";
    result.pages.forEach((page, index) => {
      const frame = pageFrame(result.pages, index, layout),
        sheet = document.createElement("div");
      sheet.className = "page-sheet";
      sheet.style.cssText = `position:absolute;top:${frame.top}px;left:${frame.left}px;width:${frame.layout.width}px;height:${frame.layout.height}px`;
      sheet.innerHTML =
        page.noteHTML ||
        footnoteHTML(
          result.notes.fragments[index],
          frame.layout,
          result.notes.reserves[index],
        );
      sheets.append(sheet);
    });
    canvas.style.minHeight = pageCanvasHeight(result.pages, layout) + "px";
    measurementMs = performance.now() - began;
  } finally {
    measuring = false;
  }
}
(window as any).__notesProbe = {
  real(document: any) {
    realNotes = true;
    layout.columns = undefined;
    noteCounts = {};
    decorations = DecorationSet.empty;
    view.updateState(
      EditorState.create({
        doc: schema.nodeFromJSON(document),
        plugins: view.state.plugins,
      }),
    );
    measure();
    return { milliseconds: measurementMs, pages: result.pages.length };
  },
  narration() {
    return speechText(view.state.doc, 0, 0, true);
  },
  highlight(note: ReadingRange["note"]) {
    const entry = documentNotes(view.state.doc).find(
      (entry) => entry.id === note!.id,
    )!;
    reading = { start: 0, end: 0, note };
    view.updateState(view.state);
    const ranges = noteReadingRanges()(canvas, note!);
    return {
      text: ranges.map((range) => range.toString()).join(""),
      rects: ranges.flatMap((range) =>
        [...range.getClientRects()].map((rect) => ({
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        })),
      ),
      ink: host.querySelector(".reading-ink")?.getBoundingClientRect().toJSON(),
      page: physicalPageAtPosition(result.pages, entry.pos),
    };
  },
  measureText(body: any, number = "1") {
    return measureNoteLines(body, number, 340, "Arial", schema);
  },
  load(document: any, counts: Record<string, number>) {
    noteCounts = counts;
    decorations = DecorationSet.empty;
    view.updateState(
      EditorState.create({
        doc: schema.nodeFromJSON(document),
        plugins: view.state.plugins,
      }),
    );
    measure();
  },
  result() {
    return {
      ...result,
      trace,
      anchors: notes().map((note) => ({
        id: note.id,
        page: physicalPageAtPosition(result.pages, note.pos),
      })),
    };
  },
  text() {
    return view.state.doc.textContent;
  },
  insert(pos: number, text: string) {
    view.dispatch(view.state.tr.insertText(text, pos));
    return measurementMs;
  },
  append(text:string){view.dispatch(view.state.tr.insertText(text,view.state.doc.content.size-1));return measurementMs;},
  select(pos: number) {
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)),
    );
    view.focus();
  },
  scale(value: number) {
    shell.style.zoom = String(value);
    measure();
  },
  columns(count: number) {
    layout.columns = { count, gapMm: 8 };
    measure();
  },
  capture() {
    const publication = capturePagePublication(
      view,
      layout,
      result.pages,
      "notes-prototype",
    );
    publication.pages.forEach((page, index) => {
      page.html = page.html.replace(
        /<\/section>$/,
        footnoteHTML(
          result.notes.fragments[index],
          pageFrame(result.pages, index, layout).layout,
          result.notes.reserves[index],
        ) + "</section>",
      );
    });
    return publicationHTML(publication);
  },
};
