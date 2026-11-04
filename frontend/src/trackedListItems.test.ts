// @vitest-environment jsdom
import { expect,it } from 'vitest';
import { EditorState,TextSelection } from 'prosemirror-state';
import { history,undo,redo } from 'prosemirror-history';
import { splitListItem } from 'prosemirror-schema-list';
import { DOMSerializer } from 'prosemirror-model';
import { schema } from './Editor';
import { identifiedDocument,blockIdentities } from './blockIdentities';
import { insertListItem,deleteListItems } from './trackedListItems';
import { trackReviewTransaction,reviewedDocument,resolveReviewChanges,reviewChanges } from './trackedReview';
import { validateReviewMoves } from './trackedMoves';
import { clipboardSlice } from './pasteText';
import { ordinaryListLabels,outlineListLayout,defaultListTemplate } from './outlineLists';
const stamp={id:'item-change',author:'Reviewer',date:''};
const p=(text:string)=>schema.node('paragraph',null,text?schema.text(text):undefined);
const item=(text:string)=>schema.node('list_item',null,p(text));
const initial=(outline=false)=>{
  const doc=identifiedDocument(schema.node('doc',null,schema.node('ordered_list',{order:3,...(outline?{listTemplate:defaultListTemplate()}: {})},['First','Middle','Last'].map(item))));
  return EditorState.create({doc,selection:TextSelection.create(doc,doc.firstChild!.firstChild!.nodeSize+3),plugins:[history(),blockIdentities()]});
};
it.each([false,true])('retains complete item deletion, numbering, review, clipboard and history (outline=%s)',outline=>{
  let state=initial(outline);const before=state.doc;let operation:any;
  deleteListItems(state,tr=>operation=tr);state=state.applyTransaction(trackReviewTransaction(state,operation,stamp)).state;
  validateReviewMoves(state.doc);expect(reviewChanges(state.doc)).toHaveLength(1);
  expect(reviewedDocument(state.doc,'original').eq(before)).toBe(true);
  expect(reviewedDocument(state.doc,'final').eq(operation.doc)).toBe(true);
  expect(outline?outlineListLayout(state.doc).markers.map(m=>m.label):ordinaryListLabels(state.doc).map(m=>m.label)).toEqual(outline?['3.','4.','4.']:['3. ','4. ','4. ']);
  const container=document.createElement('div');container.append(DOMSerializer.fromSchema(schema).serializeFragment(state.doc.content));
  validateReviewMoves(schema.node('doc',null,clipboardSlice(schema,'',container.innerHTML,'source').content));
  for(const decision of ['accept','reject'] as const)expect(state.applyTransaction(resolveReviewChanges(state,new Set([stamp.id]),decision)).state.doc.eq(decision==='accept'?operation.doc:before)).toBe(true);
  const pending=state.doc;undo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(before)).toBe(true);redo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(pending)).toBe(true);
});
it.each(['menu','enter'])('new item owns typing and can be cancelled independently (%s)',command=>{
  let state=initial();const before=state.doc;
  if(command==='enter')state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,state.selection.$from.end())));
  let operation:any;(command==='enter'?splitListItem(schema.nodes.list_item):insertListItem(1))(state,tr=>operation=tr);
  state=state.applyTransaction(trackReviewTransaction(state,operation,stamp)).state;
  validateReviewMoves(state.doc);expect(reviewChanges(state.doc)).toHaveLength(1);
  const added=state.doc;
  state=state.applyTransaction(trackReviewTransaction(state,state.tr.insertText('Added'),{...stamp,id:'typing'})).state;
  expect(reviewChanges(state.doc)).toHaveLength(1);expect(reviewedDocument(state.doc,'original').eq(before)).toBe(true);
  const typed=state.doc;deleteListItems(state,tr=>state=state.applyTransaction(trackReviewTransaction(state,tr,{...stamp,id:'cancel'})).state);
  expect(state.doc.eq(before)).toBe(true);undo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(typed)).toBe(true);
  undo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(added)).toBe(true);
});

it.each(['nested','cell'])('deletes selected items with all their content inside a %s',container=>{
  const inner=schema.node('ordered_list',null,[item('First'),schema.node('list_item',null,[p('Middle'),p('Continuation'),schema.node('bullet_list',null,item('Nested'))]),item('Last')]);
  const wrapped=container==='nested'?schema.node('bullet_list',null,schema.node('list_item',null,[p('Outer'),inner])):schema.node('table',null,schema.node('table_row',null,schema.node('table_cell',null,[p('Outer'),inner])));
  const doc=identifiedDocument(schema.node('doc',null,wrapped));let from=0,to=0;
  doc.descendants((n,pos)=>{if(n.isTextblock&&n.textContent==='Middle')from=pos+1;if(n.isTextblock&&n.textContent==='Last')to=pos+1+n.content.size;});
  let state=EditorState.create({doc,selection:TextSelection.create(doc,from,to),plugins:[history(),blockIdentities()]});let operation:any;
  deleteListItems(state,tr=>operation=tr);state=state.applyTransaction(trackReviewTransaction(state,operation,stamp)).state;
  validateReviewMoves(state.doc);expect(reviewChanges(state.doc)).toHaveLength(1);
  expect(reviewedDocument(state.doc,'original').eq(doc)).toBe(true);expect(reviewedDocument(state.doc,'final').eq(operation.doc)).toBe(true);
  expect(reviewedDocument(state.doc,'final').textContent).toBe('OuterFirst');
  const pending=state.doc;state=state.applyTransaction(resolveReviewChanges(state,new Set([stamp.id]),'accept')).state;
  undo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(pending)).toBe(true);
});

it('cancels one inserted item without losing its remaining review group',()=>{
  let state=initial();const before=state.doc,at=1+before.firstChild!.firstChild!.nodeSize;
  state=state.applyTransaction(trackReviewTransaction(state,state.tr.insert(at,[item('Added A'),item('Added B')]),stamp)).state;
  state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,at+2)));
  const pending=state.doc;deleteListItems(state,tr=>state=state.applyTransaction(trackReviewTransaction(state,tr,{...stamp,id:'cancel'})).state);
  validateReviewMoves(state.doc);expect(reviewChanges(state.doc)).toHaveLength(1);
  expect(state.doc.firstChild!.child(1).textContent).toBe('Added B');expect(state.doc.firstChild!.child(1).attrs.revisionBlock).toMatchObject({count:1,part:0});
  expect(reviewedDocument(state.doc,'original').eq(before)).toBe(true);
  undo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(pending)).toBe(true);
});
