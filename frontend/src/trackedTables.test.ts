// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { DOMSerializer } from 'prosemirror-model';
import { deleteTable, addRowAfter, TableMap } from 'prosemirror-tables';
import { history, undo, redo } from 'prosemirror-history';
import { schema } from './Editor';
import { blockIdentities, identifiedDocument } from './blockIdentities';
import { trackReviewTransaction, reviewedDocument, reviewChanges, resolveReviewChanges } from './trackedReview';
import { validateReviewMoves } from './trackedMoves';
import { insertDocumentTable } from './tableStructure';
import { clipboardSlice } from './pasteText';
import { documentText } from './textProjection';

const stamp={id:'table-change',author:'Reviewer',date:''};
const para=(text='')=>schema.node('paragraph',null,text?schema.text(text):undefined);
const table=()=>schema.node('table',null,[schema.node('table_row',null,[schema.node('table_cell',null,para('Left')),schema.node('table_cell',null,para('Right'))])]);

it('inserts a table in a blank paragraph, retaining its style and owning subsequent edits',()=>{
  const doc=identifiedDocument(schema.node('doc',null,schema.node('paragraph',{align:'right',fontFamily:'Cambria'})));
  let state=EditorState.create({doc,plugins:[history(),blockIdentities()]});
  const dispatch=(tr:any)=>{state=state.applyTransaction(trackReviewTransaction(state,tr,stamp)).state;};
  insertDocumentTable(2,2)(state,dispatch);
  expect(state.selection.$from.parent.type.name).toBe('paragraph');
  expect(state.doc.firstChild!.attrs.revisionBlock.kind).toBe('insertion');
  dispatch(state.tr.insertText('New cell wording.'));
  const beforeRow=state.doc;
  addRowAfter(state,dispatch);
  validateReviewMoves(state.doc);expect(reviewChanges(state.doc)).toHaveLength(1);
  expect(state.doc.firstChild!.childCount).toBe(3);
  undo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(beforeRow)).toBe(true);
  redo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.firstChild!.childCount).toBe(3);
  expect(reviewedDocument(state.doc,'original').eq(doc)).toBe(true);
  expect(documentText(reviewedDocument(state.doc,'final').toJSON())).toContain('New cell wording.');
  const beforeCancel=state.doc;
  deleteTable(state,dispatch);expect(state.doc.eq(doc)).toBe(true);expect(reviewChanges(state.doc)).toHaveLength(0);
  undo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(beforeCancel)).toBe(true);
});

it.each([false,true])('deletes a complete table with both review outcomes (only block=%s)',only=>{
  const doc=identifiedDocument(schema.node('doc',null,[table(),...(!only?[para('After.')]:[])]));
  let state=EditorState.create({doc,selection:TextSelection.create(doc,4),plugins:[history(),blockIdentities()]});
  let source:any;deleteTable(state,tr=>source=tr);
  state=state.applyTransaction(trackReviewTransaction(state,source,stamp)).state;
  validateReviewMoves(state.doc);expect(reviewChanges(state.doc)).toHaveLength(1);
  expect(reviewedDocument(state.doc,'original').eq(doc)).toBe(true);
  expect(documentText(reviewedDocument(state.doc,'final').toJSON())).toBe(documentText(source.doc.toJSON()));
  const html=document.createElement('div');html.append(DOMSerializer.fromSchema(schema).serializeFragment(state.doc.content));
  const copied=schema.node('doc',null,clipboardSlice(schema,'',html.innerHTML,'source').content);validateReviewMoves(copied);
  expect(copied.firstChild!.attrs.revisionBlock.kind).toBe('deletion');
  for(const decision of ['accept','reject'] as const){
    const result=state.applyTransaction(resolveReviewChanges(state,new Set([stamp.id]),decision)).state.doc;
    expect(documentText(result.toJSON())).toBe(documentText((decision==='accept'?source.doc:doc).toJSON()));
    if(decision==='reject')expect(TableMap.get(result.firstChild!).problems).toBeNull();
  }
  const pending=state.doc;
  undo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(doc)).toBe(true);
  redo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(pending)).toBe(true);
});

it('tracks deleting a nested table without deleting its containing cell',()=>{
  const doc=identifiedDocument(schema.node('doc',null,schema.node('table',null,schema.node('table_row',null,schema.node('table_cell',null,[para('Outer'),table()])))));
  let pos=0;doc.descendants((n,p)=>{if(n.type.name==='paragraph'&&n.textContent==='Left')pos=p+1;});
  let state=EditorState.create({doc,selection:TextSelection.create(doc,pos)});
  deleteTable(state,tr=>state=state.applyTransaction(trackReviewTransaction(state,tr,stamp)).state);
  validateReviewMoves(state.doc);expect(reviewedDocument(state.doc,'original').eq(doc)).toBe(true);
  expect(documentText(reviewedDocument(state.doc,'final').toJSON())).toBe('Outer');
});

it.each(['middle','start','end','selection','paragraphs','nested','list'])('inserts a table through prose and restores its structure (%s)',where=>{
  const prose=[para('Before selected after.'),para('Second paragraph.')];
  const content=where==='nested'?[schema.node('table',null,schema.node('table_row',null,schema.node('table_cell',null,prose)))]:
    where==='list'?[schema.node('bullet_list',null,schema.node('list_item',null,prose))]:prose;
  const doc=identifiedDocument(schema.node('doc',null,content));
  let first=0,second=0;doc.descendants((node,pos)=>{if(node.textContent==='Before selected after.'&&node.type.name==='paragraph')first=pos+1;if(node.textContent==='Second paragraph.'&&node.type.name==='paragraph')second=pos+1;});
  const from=first+(where==='start'?0:where==='end'?prose[0].content.size:7);
  const to=where==='selection'?from+8:where==='paragraphs'?second+7:from;
  let state=EditorState.create({doc,selection:TextSelection.create(doc,from,to),plugins:[history(),blockIdentities()]});
  let source:any;insertDocumentTable(1,2)(state,tr=>source=tr);
  const tracked=trackReviewTransaction(state,source,stamp);expect(tracked.getMeta('structuralReview')).toBe(true);
  state=state.applyTransaction(tracked).state;
  expect(state.selection.$from.parent.type.name).toBe('paragraph');
  validateReviewMoves(state.doc);expect(reviewChanges(state.doc)).toHaveLength(1);
  expect(reviewedDocument(state.doc,'original').eq(doc)).toBe(true);
  expect(documentText(reviewedDocument(state.doc,'final').toJSON())).toBe(documentText(source.doc.toJSON()));
  const pending=state.doc;
  for(const decision of ['accept','reject'] as const){
    const result=state.applyTransaction(resolveReviewChanges(state,new Set([stamp.id]),decision)).state.doc;
    if(decision==='reject')expect(result.eq(doc)).toBe(true);
    else expect(documentText(result.toJSON())).toBe(documentText(source.doc.toJSON()));
  }
  if(['middle','nested','list'].includes(where)){
    deleteTable(state,tr=>state=state.applyTransaction(trackReviewTransaction(state,tr,stamp)).state);
    expect(state.doc.eq(doc)).toBe(true);expect(reviewChanges(state.doc)).toHaveLength(0);
    undo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(pending)).toBe(true);
  }
  undo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(doc)).toBe(true);
  redo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(pending)).toBe(true);
});
