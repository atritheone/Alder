// @vitest-environment jsdom
import { expect,it } from 'vitest';
import { EditorState,TextSelection } from 'prosemirror-state';
import { DOMSerializer } from 'prosemirror-model';
import { history,undo,redo } from 'prosemirror-history';
import { schema } from './Editor';
import { blockIdentities,identifiedDocument } from './blockIdentities';
import { moveListItems } from './listItemMoves';
import { trackReviewTransaction,reviewedDocument,resolveReviewChanges,reviewChanges } from './trackedReview';
import { validateReviewMoves } from './trackedMoves';
import { defaultListTemplate,outlineListLayout,ordinaryListLabels } from './outlineLists';
import { listOrders } from './listFormatting';
import { clipboardSlice } from './pasteText';
const stamp={id:'item-move',author:'Reviewer',date:''};
const p=(text:string)=>schema.node('paragraph',null,schema.text(text));
const item=(text:string)=>schema.node('list_item',null,p(text));
it.each([false,true])('moves a complete item and its sublist with stable numbering, review and undo (outline=%s)',outline=>{
  const nested=schema.node('ordered_list',null,[item('Nested one'),item('Nested two')]);
  const moved=schema.node('list_item',null,[p('Moved wording'),p('Continuation'),nested]);
  const attrs={order:3,listStyle:'upper-alpha',...(outline?{listTemplate:defaultListTemplate()}: {})};
  const list=schema.node('ordered_list',attrs,[item('First'),moved,item('Last')]);
  const doc=identifiedDocument(schema.node('doc',null,[list,p('Between'),schema.node('ordered_list',{...attrs,order:6,continuePrevious:true},item('Continued'))]));
  const from=1+doc.firstChild!.firstChild!.nodeSize+2+6;
  let state=EditorState.create({doc,selection:TextSelection.create(doc,from,from+4),plugins:[history(),blockIdentities()]});
  let source:any;moveListItems(1)(state,tr=>source=tr);expect(source.doc.textBetween(source.selection.from,source.selection.to)).toBe('word');
  state=state.applyTransaction(trackReviewTransaction(state,source,stamp)).state;
  validateReviewMoves(state.doc);expect(reviewChanges(state.doc)).toHaveLength(1);
  expect(state.doc.textBetween(state.selection.from,state.selection.to)).toBe('word');
  expect(reviewedDocument(state.doc,'original').eq(doc)).toBe(true);expect(reviewedDocument(state.doc,'final').eq(source.doc)).toBe(true);
  expect(listOrders(state.doc)).toEqual([]);
  if(outline){const labels=outlineListLayout(state.doc).markers;expect(labels.map(x=>x.label)).toEqual(['3.','5.','5.1.','5.2.','4.','5.','5.1.','5.2.','6.']);}
  else expect(ordinaryListLabels(state.doc).map(x=>x.label)).toEqual(['C. ','E. ','D. ','E. ','F. ']);
  const html=document.createElement('div');html.append(DOMSerializer.fromSchema(schema).serializeFragment(state.doc.content));
  const copied=schema.node('doc',null,clipboardSlice(schema,'',html.innerHTML,'source').content);validateReviewMoves(copied);
  for(const decision of ['accept','reject'] as const)expect(state.applyTransaction(resolveReviewChanges(state,new Set([stamp.id]),decision)).state.doc.eq(decision==='accept'?source.doc:doc)).toBe(true);
  const pending=state.doc;undo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(doc)).toBe(true);redo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(pending)).toBe(true);
});

it('moves the full selected band upward without moving the following item',()=>{
  const doc=identifiedDocument(schema.node('doc',null,schema.node('bullet_list',null,['First','Second','Third','Last'].map(item))));
  const list=doc.firstChild!,from=1+list.firstChild!.nodeSize+2,to=from+list.child(1).nodeSize+3;
  let state=EditorState.create({doc,selection:TextSelection.create(doc,from,to)}),source:any;
  moveListItems(-1)(state,tr=>source=tr);state=state.applyTransaction(trackReviewTransaction(state,source,stamp)).state;
  expect(reviewedDocument(state.doc,'final').textContent).toBe('SecondThirdFirstLast');
  expect(reviewedDocument(state.doc,'original').eq(doc)).toBe(true);validateReviewMoves(state.doc);
});
