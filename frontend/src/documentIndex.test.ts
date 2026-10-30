// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { schema, parseEditorDocument } from "./Editor";
import {
  setIndexEntry,
  indexEntries,
  indexGroups,
  refreshedIndex,
  indexPageText,
} from "./documentIndex";
import { documentUnits, moveArrangementUnit } from "./arrangementUnits";
import { projectText } from "./textProjection";
import {
  pageReferenceTransaction,
  pageReferenceValues,
} from "./pageReferences";
import { speechText } from "./speechText";
import { projectContentsIndex } from "./documentReferences";
import {documentBookmarks} from './documentBookmarks';
import {clipboardSlice} from './pasteText';
import {DOMSerializer} from 'prosemirror-model';
import type { Project } from "./types";
const p = (text: string) => schema.node("paragraph", null, [schema.text(text)]);
describe("anchored document indexes", () => {
  it('resolves bookmarked page ranges, follows copies, and reports broken ranges',()=>{
    const doc=parseEditorDocument({type:'doc',content:[
      {type:'paragraph',content:[{type:'bookmark',attrs:{blockId:'passage',name:'Passage',range:true}},{type:'text',text:'First page.'}]},
      {type:'paragraph',content:[{type:'text',text:'Last page.'},{type:'bookmark_end',attrs:{targetId:'passage',name:'Passage'}}]},
      {type:'paragraph',content:[{type:'index_entry',attrs:{blockId:'entry',terms:['Topic'],rangeId:'passage'}}]},
    ]}).document!;
    const split=doc.child(0).nodeSize,layout={width:500,height:700,margin:40,lineHeight:1.5,zoom:1,firstPageNumber:4};
    const pages=[{from:0,to:split,text:'First'},{from:split,to:doc.content.size,text:'Last'}];
    expect(pageReferenceValues(doc,pages,layout).references.entry).toBe('4–5');
    expect(pageReferenceValues(doc,[{from:0,to:doc.content.size,text:''}],layout).references.entry).toBe('4');
    let state=EditorState.create({schema,doc,plugins:[history()]});
    expect(setIndexEntry({terms:['Renamed'],rangeId:'passage'},'entry')(state,tr=>state=state.apply(tr))).toBe(true);
    expect(indexEntries(state.doc)[0].rangeId).toBe('passage');
    undo(state,tr=>state=state.apply(tr));expect(indexEntries(state.doc)[0].terms).toEqual(['Topic']);
    const host=document.createElement('div');host.append(DOMSerializer.fromSchema(schema).serializeFragment(doc.content));
    const copied=clipboardSlice(schema,'',host.innerHTML,'source');
    const copiedDoc=schema.node('doc',null,copied.content),range=documentBookmarks(copiedDoc)[0];
    expect(range.id).not.toBe('passage');expect(indexEntries(copiedDoc)[0].rangeId).toBe(range.id);
    const end=documentBookmarks(doc)[0].end!,broken=state.tr.delete(end,end+1).doc;
    expect(pageReferenceValues(broken,pages,layout).references.entry).toBeUndefined();
    state=EditorState.create({schema,doc:broken});
    expect(setIndexEntry({terms:['Invalid'],rangeId:'passage'},'entry')(state)).toBe(false);
  });
  it("marks without replacing selection text, retains the marker in sentence moves, and undoes", () => {
    let state = EditorState.create({
      schema,
      doc: schema.node("doc", null, [p("Alpha. Beta.")]),
      plugins: [history()],
    });
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1, 7)),
    );
    expect(
      setIndexEntry({ terms: ["Letters", "Alpha"] })(
        state,
        (tr) => (state = state.apply(tr)),
      ),
    ).toBe(true);
    expect(projectText(state.doc).text).toBe("Alpha. Beta.");
    expect(indexEntries(state.doc)).toHaveLength(1);
    expect(speechText(state.doc).text).toBe("Alpha. Beta.");
    const first = documentUnits(state.doc).find(
      (unit) => unit.kind === "sentence",
    )!;
    expect(state.doc.slice(first.from, first.to).content.toString()).toContain(
      "index_entry",
    );
    const moved = moveArrangementUnit(state, first, state.doc.content.size - 1)!
      .tr.doc;
    expect(projectText(moved).text).toBe("Beta. Alpha.");
    expect(indexEntries(moved)[0].id).toBe(indexEntries(state.doc)[0].id);
    undo(state, (tr) => (state = state.apply(tr)));
    expect(indexEntries(state.doc)).toHaveLength(0);
  });
  it("groups main/subentries and keeps formatting and page results on explicit refresh", () => {
    const sources = [
      { id: "c", terms: ["Trees", "Oak"] },
      { id: "a", terms: ["Apple"] },
      { id: "b", terms: ["Trees", "Alder"] },
      { id: "d", terms: ["Trees", "Alder"] },
    ];
    expect(indexGroups(sources).map((group) => group.terms)).toEqual([
      ["Apple"],
      ["Trees"],
      ["Trees", "Alder"],
      ["Trees", "Oak"],
    ]);
    const original = refreshedIndex(
      {
        type: "table_of_contents",
        attrs: {
          kind: "index",
          title: "Index",
          depth: 3,
          entryStyle: "entries",
        },
      },
      sources,
    );
    original.content![3].attrs!.fontSize = 17;
    original.content![3].content![2].content = [{ type: "text", text: "3, 7" }];
    const refreshed = refreshedIndex(original, sources);
    expect(refreshed.content![3].attrs!.fontSize).toBe(17);
    expect(refreshed.content![3].content![2].content![0].text).toBe("3, 7");
    expect(
      indexPageText(["a", "b", "c", "d"], { a: "iv", b: "iv", c: "1", d: "2" }),
    ).toBe("iv, 1, 2");
  });
  it("resolves all occurrence pages and flags missing anchors without deleting the other results", () => {
    const doc = parseEditorDocument({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "A" },
            { type: "index_entry", attrs: { terms: ["Term"], blockId: "one" } },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "B" },
            { type: "index_entry", attrs: { terms: ["Term"], blockId: "two" } },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "index_reference",
              attrs: {
                terms: ["Term"],
                targetIds: ["one", "two", "missing"],
                blockId: "ref",
              },
              content: [{ type: "text", text: "—" }],
            },
          ],
        },
      ],
    }).document!;
    const split = doc.child(0).nodeSize,
      layout = {
        width: 500,
        height: 700,
        margin: 40,
        lineHeight: 1.5,
        zoom: 1,
        firstPageNumber: 4,
      };
    const values = pageReferenceValues(
      doc,
      [
        { from: 0, to: split, text: "A" },
        { from: split, to: doc.content.size, text: "B" },
      ],
      layout,
    );
    const state = EditorState.create({ schema, doc }),
      tr = pageReferenceTransaction(state, values)!;
    expect(tr.doc.lastChild!.firstChild!.textContent).toBe("4, 5");
    expect(tr.doc.lastChild!.firstChild!.attrs.unresolved).toBe(true);
    expect(tr.getMeta("addToHistory")).toBe(false);
  });
  it("excludes omitted chapters and retains chapter identity for navigation", () => {
    const source = (id: string, include: boolean) => ({
      id,
      title: id,
      include,
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "index_entry", attrs: { terms: [id], blockId: id } },
            ],
          },
        ],
      },
    });
    const index = projectContentsIndex({
      styles: [],
      book: { chapters: [source("one", true), source("two", false)] },
    } as unknown as Project);
    expect(index.indexEntries).toEqual([
      { id: "one", terms: ["one"], see: undefined, chapter: "one" },
    ]);
  });
});
