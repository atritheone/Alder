import { it, expect } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { schema, parseEditorDocument } from "./Editor";
import { documentNotes, setDocumentNote,assignPageNoteNumbers } from "./documentNotes";
import {pageReferenceValues,pageReferenceTransaction} from './pageReferences';
import type {PageLayout} from './pageFlow';
import { projectText } from "./textProjection";
import { documentUnits, moveArrangementUnit } from "./arrangementUnits";
import { identifiedDocument } from "./blockIdentities";
import { speechText, spokenNoteRange } from "./speechText";
import { noteOptions } from "./noteOptions";
import { referenceIndex } from "./documentReferences";
import { copiedBookmarkTargets } from "./documentBookmarks";
const body = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Independent note." }],
    },
  ],
};
it('restarts footnotes by physical ownership, preserves authored state and resolves number references',()=>{
 const p=(id:string)=>schema.node('paragraph',null,[schema.text(id),schema.node('document_note',{blockId:id,kind:'footnote',body})]);
 const doc=schema.node('doc',null,[p('a'),p('b'),p('c'),schema.node('paragraph',null,[schema.node('cross_reference',{targetId:'c',referenceFormat:'number'},schema.text('99'))])]);
 const before=JSON.stringify(doc.toJSON()),options=noteOptions();options.footnote.restart='page';options.footnote.start=3;options.footnote.format='upperRoman';
 const split=doc.child(0).nodeSize+doc.child(1).nodeSize,pages=[{from:0,to:split,text:''},{from:split,to:doc.content.size,text:''}];
 expect(assignPageNoteNumbers(doc,pages,undefined,options)).toBe(true);
 expect(documentNotes(doc,undefined,options).map(n=>n.number)).toEqual(['III','IV','III']);
 expect(assignPageNoteNumbers(doc,pages,undefined,options)).toBe(false);
 const values=pageReferenceValues(doc,pages,{firstPageNumber:1,noteOptions:options} as PageLayout);
 expect(values.noteNumbers).toEqual({a:'III',b:'IV',c:'III'});
 const state=EditorState.create({doc}),tr=pageReferenceTransaction(state,values)!;
 expect(tr.doc.lastChild!.textContent).toBe('III');expect(tr.getMeta('addToHistory')).toBe(false);
 expect(referenceIndex([{document:doc.toJSON()}],[],options).targets.get('c')?.layoutDependent).toBe(true);
 pages[0].to=pages[1].from=doc.child(0).nodeSize;
 assignPageNoteNumbers(doc,pages,undefined,options);
 expect(documentNotes(doc,undefined,options).map(n=>n.number)).toEqual(['III','III','IV']);
 expect(JSON.stringify(doc.toJSON())).toBe(before);
});
it("keeps note bodies out of body counts and moves the reference with its sentence", () => {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, schema.text("First. Second.")),
  ]);
  let state = EditorState.create({
    doc,
    plugins: [history()],
    selection: TextSelection.create(doc, 1, 7),
  });
  setDocumentNote({ kind: "footnote", body })(
    state,
    (tr) => (state = state.apply(tr)),
  );
  expect(projectText(state.doc).text).toBe("First. Second.");
  const note = documentNotes(state.doc)[0];
  expect(note.number).toBe("1");
  const unit = documentUnits(state.doc).find(
    (unit) => unit.kind === "sentence",
  )!;
  const moved = moveArrangementUnit(state, unit, state.doc.content.size - 1)!.tr
    .doc;
  expect(projectText(moved).text).toBe("Second. First.");
  expect(documentNotes(moved)[0].id).toBe(note.id);
  undo(state, (tr) => (state = state.apply(tr)));
  expect(documentNotes(state.doc)).toHaveLength(0);
});
it("renumbers independent footnote/endnote sequences and rejects nested notes", () => {
  const doc = parseEditorDocument({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: ["footnote", "endnote", "footnote", "endnote"].map(
          (kind, index) => ({
            type: "document_note",
            attrs: { kind, body, blockId: "note_" + index },
          }),
        ),
      },
    ],
  }).document!;
  expect(documentNotes(doc).map((note) => note.number)).toEqual([
    "1",
    "i",
    "2",
    "ii",
  ]);
  expect(
    documentNotes(doc, { footnote: 4, endnote: 2 }).map((note) => note.number),
  ).toEqual(["5", "iii", "6", "iv"]);
  const invalid = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "document_note",
            attrs: {
              kind: "footnote",
              body: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "document_note",
                        attrs: { kind: "footnote", body },
                      },
                    ],
                  },
                ],
              },
            },
          },
        ],
      },
    ],
  };
  expect(parseEditorDocument(invalid).document).toBeNull();
});
it("gives note paragraphs independent identities before saving or copying", () => {
  let state = EditorState.create({ schema });
  setDocumentNote({ kind: "footnote", body })(state, (tr) => {
    state = state.apply(tr);
  });
  const original = documentNotes(state.doc)[0];
  expect(original.value.body.content![0].attrs!.blockId).toBeTruthy();
  const copy = identifiedDocument(
    schema.node("doc", null, [state.doc.firstChild!, state.doc.firstChild!]),
  );
  const entries = documentNotes(copy);
  expect(entries[0].id).not.toBe(entries[1].id);
  expect(entries[0].value.body.content![0].attrs!.blockId).not.toBe(
    entries[1].value.body.content![0].attrs!.blockId,
  );
  expect(identifiedDocument(copy)).toBe(copy);
});
it("narrates note bodies only when references are enabled and maps words to the note", () => {
  const note = schema.nodes.document_note.create({
    blockId: "test",
    kind: "footnote",
    body: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "😀 Note words." }],
        },
      ],
    },
  });
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [
      schema.text("First."),
      note,
      schema.text(" Next."),
    ]),
  ]);
  expect(speechText(doc).text).toBe("First. Next.");
  const read = speechText(doc, 0, 0, true);
  expect(read.text).toBe("First.\n😀 Note words.\n Next.");
  const at = Array.from(read.text.slice(0, read.text.indexOf("Note"))).length;
  expect(spokenNoteRange(read.notes, at, at + 4)).toEqual({
    id: "test",
    start: 3,
    end: 7,
  });
  expect(read.offsets[at]).toBe(6);
  expect(speechText(doc, 7, 0, true).notes).toBeUndefined();
  expect(speechText(doc, 0, 6, true).text).toContain("Note words.");
});
it("continues configurable numbering across chapters and restarts at actual sections", () => {
  const options = noteOptions();
  options.footnote = {
    format: "upperRoman",
    start: 3,
    restart: "section",
    placement: "beneathText",
  };
  const paragraph = (id: string) =>
    schema.node("paragraph", null, [
      schema.text("Text"),
      schema.node("document_note", { blockId: id, kind: "footnote", body }),
    ]);
  const doc = schema.node("doc", null, [
    paragraph("a"),
    paragraph("b"),
    schema.node("section_break"),
    paragraph("c"),
  ]);
  expect(
    documentNotes(doc, { footnote: 2, endnote: 0 }, options).map(
      (note) => note.number,
    ),
  ).toEqual(["V", "VI", "III"]);
  const index = referenceIndex([{ document: doc.toJSON() }], [], options);
  expect(index.targets.get("a")?.kind).toBe("note");
  expect(index.resolve("a", "number")).toBe("III");
  expect(index.resolve("b", "number")).toBe("IV");
  expect(index.resolve("c", "number")).toBe("III");
  const copied = copiedBookmarkTargets(doc.content);
  expect(copied.links.has("a")).toBe(true);
  expect(copied.links.get("a")).not.toBe("a");
});
