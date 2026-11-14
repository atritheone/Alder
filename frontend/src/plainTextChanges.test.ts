import { expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { changedPlainDocument } from "./plainTextChanges";
import { plainTextDocument } from "./plainTextTools";
import { documentText } from "./textProjection";

it("matches full text projection across mixed inserts, deletes, Unicode and batched edits", () => {
  let state = EditorState.create({doc:"one\n😀 two\nthree\nfour"});
  let doc = plainTextDocument(state.doc.toString());
  for (let i=0;i<150;i++) {
    const from = (i*17) % (state.doc.length+1);
    // Avoid cutting surrogate pairs; arbitrary UTF-16 boundaries are not text edits.
    const safe = from>0 && /[\uDC00-\uDFFF]/.test(state.doc.sliceString(from,from+1)) ? from-1 : from;
    const tr = state.update({changes:{from:safe,to:safe,insert:i%3===0?"\nnew\n":"x"}});
    doc = changedPlainDocument(doc,state.doc,tr.state.doc,tr.changes);state=tr.state;
    expect(documentText(doc)).toBe(state.doc.toString());
  }
  const tr = state.update({changes:[{from:0,to:5,insert:""},{from:state.doc.length-3,to:state.doc.length,insert:"tail\n"}]});
  expect(documentText(changedPlainDocument(doc,state.doc,tr.state.doc,tr.changes))).toBe(tr.state.doc.toString());
});
it("retains shifted untouched paragraphs after newline edits", () => {
  const state=EditorState.create({doc:"one\ntwo\nthree"}),doc=plainTextDocument(state.doc.toString());
  const tr=state.update({changes:{from:1,insert:"\n"}});
  const next=changedPlainDocument(doc,state.doc,tr.state.doc,tr.changes);
  expect(next.content![2]).toBe(doc.content![1]);
  expect(next.content![3]).toBe(doc.content![2]);
});
