// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { addRowAfter, deleteRow, mergeCells, TableMap, CellSelection } from 'prosemirror-tables';
import { DOMSerializer } from 'prosemirror-model';
import { history, undo, redo } from 'prosemirror-history';
import { schema } from './Editor';
import { identifiedDocument, blockIdentities } from './blockIdentities';
import { trackReviewTransaction, reviewedDocument, resolveReviewChanges, reviewChanges, editReviewedDocument } from './trackedReview';
import { validateReviewMoves } from './trackedMoves';
import { clipboardSlice } from './pasteText';
import { documentText } from './textProjection';
import { insertTableRows } from './tableStructure';
const stamp={id:'row-change',author:'Reviewer',date:''};
const p=(text:string)=>schema.node('paragraph',null,text?schema.text(text):undefined);
const row=(text:string)=>schema.node('table_row',null,[schema.node('table_cell',null,p(text)),schema.node('table_cell',null,p(text+' right'))]);
const initial=()=>{
  const doc=identifiedDocument(schema.node('doc',null,[schema.node('table',null,[row('First'),row('Middle'),row('Last')]),p('After')]));
  const table=doc.firstChild!;const pos=1+TableMap.get(table).map[2]+2;
  return EditorState.create({doc,selection:TextSelection.create(doc,pos),plugins:[history(),blockIdentities()]});
};
function mergedRows(){
  return [schema.node('table_row',null,[schema.node('table_cell',{rowspan:2},p('Merged')),schema.node('table_cell',null,p('Upper right'))]),
    schema.node('table_row',null,[schema.node('table_cell',null,p('Lower right'))])];
}
it.each(['insert','delete'])('tracks a complete vertically merged row band (%s)',kind=>{
  const doc=identifiedDocument(schema.node('doc',null,schema.node('table',null,[row('Before'),...(kind==='delete'?mergedRows():[]),row('After')])));
  let state=EditorState.create({doc,plugins:[history(),blockIdentities()]});let operation:any;
  if(kind==='delete'){
    const map=TableMap.get(doc.firstChild!);
    state=state.apply(state.tr.setSelection(CellSelection.rowSelection(doc.resolve(1+map.map[2]),doc.resolve(1+map.map[5]))));
    deleteRow(state,tr=>operation=tr);
  }else operation=state.tr.insert(1+doc.firstChild!.firstChild!.nodeSize,mergedRows());
  state=state.applyTransaction(trackReviewTransaction(state,operation,stamp)).state;
  validateReviewMoves(state.doc);
  expect(reviewChanges(state.doc)).toHaveLength(1);
  for(const view of ['original','final'] as const){
    const result=reviewedDocument(state.doc,view);expect(TableMap.get(result.firstChild!).problems).toBeNull();
    expect(documentText(result.toJSON())).toBe(documentText((view==='original'?doc:operation.doc).toJSON()));
    const survives=(view==='final')===(kind==='insert');expect(result.firstChild!.childCount).toBe(survives?4:2);
    if(survives)expect(result.firstChild!.child(1).firstChild!.attrs.rowspan).toBe(2);
  }
  const html=document.createElement('div');html.append(DOMSerializer.fromSchema(schema).serializeFragment(state.doc.content));
  const copied=schema.node('doc',null,clipboardSlice(schema,'',html.innerHTML,'source').content);validateReviewMoves(copied);
  const pending=state.doc;
  for(const decision of ['accept','reject'] as const){
    const result=state.applyTransaction(resolveReviewChanges(state,new Set([stamp.id]),decision)).state.doc;
    expect(TableMap.get(result.firstChild!).problems).toBeNull();
  }
  undo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(doc)).toBe(true);
  redo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(pending)).toBe(true);
});

it('keeps merging cells across an inserted row group within the original insertion review',()=>{
  let state=initial();const before=state.doc;
  const map=TableMap.get(before.firstChild!);
  state=state.apply(state.tr.setSelection(CellSelection.rowSelection(before.resolve(1+map.map[0]),before.resolve(1+map.map[2]))));
  insertTableRows(1)(state,tr=>state=state.applyTransaction(trackReviewTransaction(state,tr,stamp)).state);
  const table=state.doc.firstChild!,after=TableMap.get(table);
  state=state.apply(state.tr.setSelection(new CellSelection(state.doc.resolve(1+after.map[4]),state.doc.resolve(1+after.map[6]))));
  const unmerged=state.doc;
  mergeCells(state,tr=>state=state.applyTransaction(trackReviewTransaction(state,tr,{...stamp,id:'merge'})).state);
  expect(reviewChanges(state.doc)).toHaveLength(1);validateReviewMoves(state.doc);
  expect(state.doc.firstChild!.child(2).firstChild!.attrs.rowspan).toBe(2);
  expect(reviewedDocument(state.doc,'original').eq(before)).toBe(true);
  expect(TableMap.get(reviewedDocument(state.doc,'final').firstChild!).problems).toBeNull();
  undo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(unmerged)).toBe(true);
});
it.each(['insert','delete'])('tracks a complete row %s through review, copies and history',kind=>{
  let state=initial();const before=state.doc;
  const command=kind==='insert'?addRowAfter:deleteRow;let operation:any;
  expect(command(state,tr=>operation=tr)).toBe(true);const after=operation.doc;
  state=state.applyTransaction(trackReviewTransaction(state,operation,stamp)).state;
  validateReviewMoves(state.doc);const pending=state.doc;
  expect(reviewChanges(pending)).toHaveLength(1);
  expect(reviewedDocument(pending,'original').eq(before)).toBe(true);
  expect(documentText(reviewedDocument(pending,'final').toJSON())).toBe(documentText(after.toJSON()));
  const html=document.createElement('div');html.append(DOMSerializer.fromSchema(schema).serializeFragment(pending.content));
  const copied=schema.node('doc',null,clipboardSlice(schema,'',html.innerHTML,'source').content);validateReviewMoves(copied);
  for(const view of ['original','final'] as const)expect(documentText(reviewedDocument(copied,view).toJSON())).toBe(documentText(reviewedDocument(pending,view).toJSON()));
  for(const decision of ['accept','reject'] as const){
    const result=state.applyTransaction(resolveReviewChanges(state,new Set([stamp.id]),decision)).state.doc;
    expect(documentText(result.toJSON())).toBe(documentText((decision==='accept'?after:before).toJSON()));
    expect(TableMap.get(result.firstChild!).problems).toBeNull();
  }
  undo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(before)).toBe(true);
  redo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(pending)).toBe(true);
});
it('keeps typing inside an inserted row in the same review decision',()=>{
  let state=initial();addRowAfter(state,tr=>state=state.applyTransaction(trackReviewTransaction(state,tr,stamp)).state);
  let pos=0;state.doc.descendants((n,p)=>{if(n.type.name==='table_row'&&n.attrs.revisionBlock)pos=p+3;});
  state=state.applyTransaction(trackReviewTransaction(state,state.tr.insertText('New row wording',pos),{...stamp,id:'typing'})).state;
  expect(reviewChanges(state.doc)).toHaveLength(1);
  expect(documentText(reviewedDocument(state.doc,'final').toJSON())).toContain('New row wording');
  expect(documentText(reviewedDocument(state.doc,'original').toJSON())).not.toContain('New row wording');
});

it('cancels a pending row insertion when that row is deleted, with undo',()=>{
  let state=initial();const original=state.doc;
  addRowAfter(state,tr=>state=state.applyTransaction(trackReviewTransaction(state,tr,stamp)).state);
  let pos=0;state.doc.descendants((n,p)=>{if(n.type.name==='table_row'&&n.attrs.revisionBlock)pos=p+3;});
  state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,pos)));
  state=state.applyTransaction(editReviewedDocument(state,state.tr.insertText('Wording'))).state;
  const pending=state.doc;
  deleteRow(state,tr=>state=state.applyTransaction(trackReviewTransaction(state,tr,{...stamp,id:'remove'})).state);
  expect(reviewChanges(state.doc)).toHaveLength(0);expect(state.doc.eq(original)).toBe(true);
  undo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(pending)).toBe(true);
});

it.each(['insert','delete'])('tracks %s in a nested table without changing the outer grid',kind=>{
  const inner=initial().doc.firstChild!;
  const doc=identifiedDocument(schema.node('doc',null,[schema.node('table',null,[schema.node('table_row',null,[schema.node('table_cell',null,[p('Outer'),inner])])])]));
  let pos=0;doc.descendants((n,p)=>{if(n.isTextblock&&n.textContent==='Middle')pos=p+1;});
  let state=EditorState.create({doc,selection:TextSelection.create(doc,pos)});
  (kind==='insert'?addRowAfter:deleteRow)(state,tr=>state=state.applyTransaction(trackReviewTransaction(state,tr,stamp)).state);
  validateReviewMoves(state.doc);expect(reviewChanges(state.doc)).toHaveLength(1);
  expect(reviewedDocument(state.doc,'original').eq(doc)).toBe(true);
  expect(state.doc.firstChild!.childCount).toBe(1);
  expect(TableMap.get(state.doc.firstChild!).problems).toBeNull();
});

it('reviews deleting two selected rows as one change and restores both on undo',()=>{
  let state=initial();const before=state.doc,map=TableMap.get(before.firstChild!);
  state=state.apply(state.tr.setSelection(CellSelection.rowSelection(before.resolve(1+map.map[0]),before.resolve(1+map.map[2]))));
  deleteRow(state,tr=>state=state.applyTransaction(trackReviewTransaction(state,tr,stamp)).state);
  validateReviewMoves(state.doc);expect(reviewChanges(state.doc)).toHaveLength(1);
  expect(reviewedDocument(state.doc,'original').eq(before)).toBe(true);
  expect(reviewedDocument(state.doc,'final').firstChild!.childCount).toBe(1);
  const pending=state.doc;
  state=state.applyTransaction(resolveReviewChanges(state,new Set([stamp.id]),'accept')).state;
  expect(state.doc.firstChild!.childCount).toBe(1);
  undo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(pending)).toBe(true);
  undo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(before)).toBe(true);
});

it('can cancel one row of an inserted group without losing the remaining revision',()=>{
  let state=initial();const before=state.doc,at=1+before.firstChild!.firstChild!.nodeSize;
  state=state.applyTransaction(trackReviewTransaction(state,state.tr.insert(at,[row('Added A'),row('Added B')]),stamp)).state;
  expect(reviewChanges(state.doc)).toHaveLength(1);validateReviewMoves(state.doc);
  state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,at+3)));
  deleteRow(state,tr=>state=state.applyTransaction(trackReviewTransaction(state,tr,{...stamp,id:'cancel'})).state);
  validateReviewMoves(state.doc);expect(reviewChanges(state.doc)).toHaveLength(1);
  const remaining=state.doc.firstChild!.child(1);expect(remaining.textContent).toContain('Added B');
  expect(remaining.attrs.revisionBlock.count).toBe(1);expect(remaining.attrs.revisionBlock.part).toBe(0);
  expect(reviewedDocument(state.doc,'original').eq(before)).toBe(true);
  state=state.applyTransaction(resolveReviewChanges(state,new Set([stamp.id]),'reject')).state;
  expect(state.doc.eq(before)).toBe(true);
});

it.each([-1,1] as const)('inserts rows for the selected band in direction %s as one tracked group',direction=>{
  let state=initial();const before=state.doc,map=TableMap.get(before.firstChild!);
  state=state.apply(state.tr.setSelection(CellSelection.rowSelection(before.resolve(1+map.map[0]),before.resolve(1+map.map[2]))));
  expect(insertTableRows(direction)(state,tr=>state=state.applyTransaction(trackReviewTransaction(state,tr,stamp)).state)).toBe(true);
  expect(state.doc.firstChild!.childCount).toBe(5);validateReviewMoves(state.doc);expect(reviewChanges(state.doc)).toHaveLength(1);
  expect(state.selection).toBeInstanceOf(TextSelection);expect(state.selection.$from.node(2).attrs.revisionBlock?.kind).toBe('insertion');
  expect(reviewedDocument(state.doc,'original').eq(before)).toBe(true);
  const html=document.createElement('div');html.append(DOMSerializer.fromSchema(schema).serializeFragment(state.doc.content));
  const copied=schema.node('doc',null,clipboardSlice(schema,'',html.innerHTML,'source').content);validateReviewMoves(copied);expect(reviewChanges(copied)).toHaveLength(1);
});
