import type { NodeSpec, Node as PMNode } from "prosemirror-model";
import { Plugin, type Command, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { closeHistory } from "prosemirror-history";
import type { DocNode, Project } from "./types";
import { formatPageNumber } from "./pageNumbering";
import { identifiedDocument } from "./blockIdentities";
import {
  noteOptions,
  noteCounter,
  type NoteContext,
  type NoteOptions,
} from "./noteOptions";
import type { FlowPage } from "./pageFlow";
import { physicalPageAtPosition } from "./pageRanges";
export type DocumentNote = { kind: "footnote" | "endnote"; body: DocNode };
export function validNoteBody(value: DocNode): boolean {
  let count = 0;
  const visit = (node: DocNode, depth: number): boolean =>
    !!node &&
    typeof node === "object" &&
    ++count <= 250000 &&
    depth <= 50 &&
    [
      "doc",
      "paragraph",
      "text",
      "hard_break",
      "document_field",
      "image",
      "inline_image",
      "bullet_list",
      "ordered_list",
      "list_item",
      "table",
      "table_row",
      "table_cell",
      "table_header",
    ].includes(node.type) &&
    !node.attrs?.revisionProperties &&
    !node.attrs?.captionLabel &&
    (node.type !== "document_field" || node.attrs?.fieldKind === "merge") &&
    (!["image", "inline_image"].includes(node.type) ||
      !node.attrs?.wrap ||
      node.attrs.wrap === "none") &&
    (!node.marks ||
      node.marks.every((mark) =>
        [
          "strong",
          "em",
          "underline",
          "strike",
          "subscript",
          "superscript",
          "text_style",
          "link",
          "highlight",
        ].includes(mark.type),
      )) &&
    (!node.content || node.content.every((child) => visit(child, depth + 1)));
  return (
    value?.type === "doc" &&
    !!value.content?.length &&
    value.content.every((node) =>
      ["paragraph", "image", "bullet_list", "ordered_list", "table"].includes(
        node.type,
      ),
    ) &&
    visit(value, 0)
  );
}
export function noteBodies(document: DocNode): DocNode[] {
  const bodies: DocNode[] = [];
  const visit = (node: DocNode) => {
    if (node.type === "document_note") bodies.push(node.attrs!.body);
    node.content?.forEach(visit);
  };
  visit(document);
  return bodies;
}
export const validDocumentNote = (value: any): value is DocumentNote =>
  !!value &&
  ["footnote", "endnote"].includes(value.kind) &&
  validNoteBody(value.body);
export const documentNoteSpec: NodeSpec = {
  inline: true,
  atom: true,
  group: "inline",
  marks: "",
  attrs: {
    blockId: { default: null },
    kind: { default: "footnote" },
    body: { default: null },
  },
  parseDOM: [
    {
      tag: "sup[data-document-note]",
      priority: 100,
      getAttrs: (element) => {
        try {
          const value = JSON.parse(element.getAttribute("data-document-note")!);
          return validDocumentNote(value)
            ? { ...value, blockId: element.getAttribute("data-note-id") }
            : false;
        } catch {
          return false;
        }
      },
    },
  ],
  toDOM: (node) => [
    "sup",
    {
      "data-document-note": JSON.stringify({
        kind: node.attrs.kind,
        body: node.attrs.body,
      }),
      "data-note-id": node.attrs.blockId,
      "data-note-number": "1",
      class: "document-note",
      contenteditable: "false",
      "aria-label": node.attrs.kind === "footnote" ? "Footnote" : "Endnote",
    },
  ],
};
export type NoteStarts = NoteContext;
const cache = new WeakMap<PMNode, Map<string, ReturnType<typeof collect>>>();
const noteContextKey = (starts: NoteStarts | undefined, options: NoteOptions) =>
  JSON.stringify([starts, options]);
function collect(
  doc: PMNode,
  starts?: NoteStarts,
  options = noteOptions(),
  pages?: FlowPage[],
) {
  const counter = noteCounter(options, starts),
    result: {
      id: string;
      pos: number;
      value: DocumentNote;
      number: string;
      options: NoteOptions;
      section: number;
    }[] = [];
  doc.descendants((node, pos) => {
    if (
      node.type.name === "table_of_contents" ||
      node.marks.some((mark) => mark.type.name === "revision_deletion")
    )
      return false;
    if (node.type.name === "section_break")
      counter.section(node.attrs.noteOptions);
    if (node.type.name === "document_note") {
      const value = node.attrs as DocumentNote,
        next = counter.next(
          value.kind,
          pages ? (physicalPageAtPosition(pages, pos) ?? 0) : undefined,
        );
      result.push({
        id: node.attrs.blockId,
        pos,
        value,
        number: formatPageNumber(next.value, next.format),
        options: next.options,
        section: next.section,
      });
    }
  });
  return result;
}
export function documentNotes(
  doc: PMNode,
  starts?: NoteStarts,
  settings?: NoteOptions,
) {
  const options = noteOptions(settings),
    key = noteContextKey(starts, options);
  let context = cache.get(doc);
  if (!context) {
    context = new Map();
    cache.set(doc, context);
  }
  let values = context.get(key);
  if (!values) {
    values = collect(doc, starts, options);
    if (context.size >= 4) context.delete(context.keys().next().value!);
    context.set(key, values);
  }
  return values;
}
/** Derived numbering shares the current editor's measured page ownership. It
 * changes neither the authored document nor undo history. */
export function assignPageNoteNumbers(
  doc: PMNode,
  pages: FlowPage[],
  starts?: NoteStarts,
  settings?: NoteOptions,
): boolean {
  const options = noteOptions(settings);
  const entries = documentNotes(doc, starts, options);
  if (
    !entries.some(
      (note) =>
        note.value.kind === "footnote" &&
        note.options.footnote.restart === "page",
    )
  )
    return false;
  const numbered = collect(doc, starts, options, pages),
    changed = numbered.some(
      (note, index) => note.number !== entries[index].number,
    );
  if (changed) cache.get(doc)!.set(noteContextKey(starts, options), numbered);
  return changed;
}
export const noteNumbers = (
  starts: () => NoteStarts | undefined = () => undefined,
  options: () => NoteOptions | undefined = () => undefined,
) => {
  let previous: ReturnType<typeof documentNotes> | undefined,
    decorations = DecorationSet.empty;
  return new Plugin({
    props: {
      decorations: (state) => {
        const entries = documentNotes(state.doc, starts(), options());
        if (entries === previous) return decorations;
        previous = entries;
        return (decorations = DecorationSet.create(
          state.doc,
          entries.map((note) =>
            Decoration.node(note.pos, note.pos + 1, {
              "data-note-number": note.number,
              "aria-label": `${note.value.kind === "footnote" ? "Footnote" : "Endnote"} ${note.number}`,
            }),
          ),
        ));
      },
    },
  });
};
const chapterEvents = new WeakMap<
  DocNode,
  ({ kind: "footnote" | "endnote" } | { options?: NoteOptions })[]
>();
export function chapterNoteStarts(project: Project, id: string): NoteStarts {
  const counter = noteCounter(project.settings.noteOptions);
  for (const chapter of project.book?.chapters || []) {
    if (chapter.id === id)
      return chapter.include === false
        ? { footnote: 0, endnote: 0 }
        : counter.snapshot();
    if (chapter.include === false || !chapter.document) continue;
    let events = chapterEvents.get(chapter.document);
    if (!events) {
      events = [];
      const walk = (node: DocNode) => {
        if (
          node.type === "table_of_contents" ||
          node.marks?.some((mark) => mark.type === "revision_deletion")
        )
          return;
        if (node.type === "section_break")
          events!.push({ options: node.attrs?.noteOptions });
        if (node.type === "document_note")
          events!.push({ kind: node.attrs!.kind });
        node.content?.forEach(walk);
      };
      walk(chapter.document);
      chapterEvents.set(chapter.document, events);
    }
    for (const event of events) {
      if ("kind" in event) counter.next(event.kind);
      else counter.section(event.options);
    }
  }
  return counter.snapshot();
}
export function sectionNoteOptions(
  doc: PMNode,
  before: number,
  settings?: NoteOptions,
  starts?: NoteStarts,
): NoteOptions {
  let options = noteOptions(starts?.options || settings);
  doc.forEach((node, pos) => {
    if (
      pos < before &&
      node.type.name === "section_break" &&
      node.attrs.noteOptions
    )
      options = noteOptions(node.attrs.noteOptions);
  });
  return options;
}
export function setDocumentNote(
  value: DocumentNote | null,
  id?: string,
): Command {
  return (state, dispatch) => {
    if (value && !validDocumentNote(value)) return false;
    // Give paragraphs identities before autosave, so server normalization
    // cannot replace the document while another note dialog is open.
    if (value)
      value = {
        ...value,
        body: identifiedDocument(
          state.schema.nodeFromJSON(value.body),
        ).toJSON(),
      };
    const old = id
      ? documentNotes(state.doc).find((note) => note.id === id)
      : undefined;
    if (
      (id && !old) ||
      (!old && (!value || !state.selection.$to.parent.inlineContent))
    )
      return false;
    if (dispatch) {
      const tr = closeHistory(state.tr);
      if (old) {
        if (value)
          tr.setNodeMarkup(old.pos, undefined, { blockId: old.id, ...value });
        else tr.delete(old.pos, old.pos + 1);
      } else {
        const pos = state.selection.to;
        tr.insert(
          pos,
          state.schema.nodes.document_note.create({
            blockId: "note_" + crypto.randomUUID(),
            ...value,
          }),
        );
        tr.setSelection(TextSelection.create(tr.doc, pos + 1));
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}
