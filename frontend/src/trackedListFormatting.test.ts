// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {EditorState,TextSelection} from 'prosemirror-state';
import {history,undo,redo} from 'prosemirror-history';
import {DOMSerializer} from 'prosemirror-model';
import {schema} from './Editor';
import {identifiedDocument,blockIdentities} from './blockIdentities';
import {setListFormatting,continuedLists,normaliseListOrders} from './listFormatting';
import {setListTemplate,defaultListTemplate,selectedOutlineList} from './outlineLists';
import {trackReviewTransaction,reviewedDocument,reviewChanges,resolveReviewChanges} from './trackedReview';
import {clipboardSlice} from './pasteText';
import {toggleList} from './editorCommands';
const stamp={id:'list-style',author:'Reviewer',date:''};
it.each([false,true].flatMap(continued=>[false,true].map(unmatched=>({continued,unmatched}))))('reviews nested continuation $continued with no predecessor $unmatched',({continued,unmatched})=>{
  const p=(text:string)=>schema.node('paragraph',null,schema.text(text)),template=defaultListTemplate();
  const list=(text:string,continuation:boolean)=>schema.node('ordered_list',{listTemplate:template,order:11,continuePrevious:continuation},schema.node('list_item',null,[p(text),p('Continuation')]));
  const first=list('First',unmatched?!continued:false),later=list('Later',unmatched?true:!continued);
  const inner=schema.node('bullet_list',null,schema.node('list_item',null,[p('Outer'),first,p('Gap'),later]));
  const doc=normaliseListOrders(identifiedDocument(schema.node('doc',null,schema.node('table',null,schema.node('table_row',null,schema.node('table_cell',null,inner))))));
  let position=0;doc.descendants((node,pos)=>{if(node.isText&&node.text===(unmatched?'First':'Later'))position=pos;});
  let state=EditorState.create({doc,selection:TextSelection.create(doc,position),plugins:[history(),blockIdentities(),continuedLists()]});
  const original=state.doc;
  let operation:any;setListTemplate(template,11,continued)(state,tr=>operation=tr);
  state=state.applyTransaction(trackReviewTransaction(state,operation,stamp)).state;
  expect(reviewChanges(state.doc)).toHaveLength(1);
  expect(selectedOutlineList(state)!.node.attrs.continuePrevious).toBe(continued);
  expect(reviewedDocument(state.doc,'original').eq(original)).toBe(true);
  const final=reviewedDocument(state.doc,'final'),pending=state.doc;
  for(const decision of ['accept','reject'] as const)expect(state.applyTransaction(resolveReviewChanges(state,new Set([stamp.id]),decision)).state.doc.eq(decision==='accept'?final:original)).toBe(true);
  undo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(original)).toBe(true);redo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(pending)).toBe(true);
});
it('edits the independent outline selected inside an ordinary parent item',()=>{
  const p=(text:string)=>schema.node('paragraph',null,schema.text(text));
  const inner=schema.node('ordered_list',{listTemplate:defaultListTemplate()},schema.node('list_item',null,p('Inner')));
  const doc=identifiedDocument(schema.node('doc',null,schema.node('bullet_list',null,schema.node('list_item',null,[p('Outer'),inner]))));
  let position=0;doc.descendants((node,pos)=>{if(node.isText&&node.text==='Inner')position=pos;});
  let state=EditorState.create({doc,selection:TextSelection.create(doc,position),plugins:[history(),blockIdentities()]});
  const root=selectedOutlineList(state)!;expect(root.node.type.name).toBe('ordered_list');expect(root.level).toBe(0);
  const template=defaultListTemplate();template[0].format='upper-roman';
  let operation:any;setListTemplate(template,4,false)(state,tr=>operation=tr);
  state=state.applyTransaction(trackReviewTransaction(state,operation,stamp)).state;
  expect(state.doc.firstChild!.type.name).toBe('bullet_list');expect(state.doc.firstChild!.attrs.listTemplate).toBeNull();
  expect(reviewedDocument(state.doc,'original').eq(doc)).toBe(true);expect(reviewChanges(state.doc)).toHaveLength(1);
});
it('converts the selected inner ordinary list without changing its parent',()=>{
  const p=(text:string)=>schema.node('paragraph',null,schema.text(text));
  const inner=schema.node('ordered_list',null,schema.node('list_item',null,p('Inner')));
  const doc=identifiedDocument(schema.node('doc',null,schema.node('bullet_list',null,schema.node('list_item',null,[p('Outer'),inner]))));
  let position=0;doc.descendants((node,pos)=>{if(node.isText&&node.text==='Inner')position=pos;});
  let state=EditorState.create({doc,selection:TextSelection.create(doc,position),plugins:[history(),blockIdentities()]});
  expect(selectedOutlineList(state,true)!.node.type.name).toBe('ordered_list');
  let operation:any;setListTemplate(defaultListTemplate(),4,false,true)(state,tr=>operation=tr);
  state=state.applyTransaction(trackReviewTransaction(state,operation,stamp)).state;
  expect(state.doc.firstChild!.type.name).toBe('bullet_list');expect(state.doc.firstChild!.attrs.listTemplate).toBeNull();
  expect(selectedOutlineList(state)!.node.attrs.listTemplate).toEqual(defaultListTemplate());
  expect(reviewedDocument(state.doc,'original').eq(doc)).toBe(true);expect(reviewChanges(state.doc)).toHaveLength(1);
  undo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(doc)).toBe(true);
});
it.each([false,true])('converts a continued list sequence to/from outlines (reverse %s)',reverse=>{
  const p=(text:string)=>schema.node('paragraph',null,schema.text(text));
  const template=defaultListTemplate();
  const list=(text:string,continuation=false)=>schema.node('ordered_list',{listTemplate:reverse?template:null,order:continuation?4:3,continuePrevious:continuation},schema.node('list_item',null,[p(text),schema.node('ordered_list',null,schema.node('list_item',null,p('Nested')))]));
  const doc=identifiedDocument(schema.node('doc',null,[list('First'),p('Gap'),list('Later',true)]));
  let state=EditorState.create({doc,selection:TextSelection.create(doc,3,6),plugins:[history(),blockIdentities(),continuedLists()]});
  let operation:any;setListTemplate(reverse?null:template,3,false)(state,tr=>operation=tr);
  state=state.applyTransaction(trackReviewTransaction(state,operation,stamp)).state;
  expect(reviewChanges(state.doc)).toHaveLength(1);
  expect(state.doc.lastChild!.attrs.listTemplate).toEqual(reverse?null:template);
  expect(state.doc.lastChild!.attrs.continuePrevious).toBe(true);
  expect(reviewedDocument(state.doc,'original').eq(doc)).toBe(true);
  const final=reviewedDocument(state.doc,'final');
  for(const decision of ['accept','reject'] as const)expect(state.applyTransaction(resolveReviewChanges(state,new Set([stamp.id]),decision)).state.doc.eq(decision==='accept'?final:doc)).toBe(true);
  undo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(doc)).toBe(true);
  expect(state.selection.from).toBe(3);expect(state.selection.to).toBe(6);
});
it.each([0,1])('keeps an outline level %s bullet conversion in one review decision',level=>{
  const p=(text:string)=>schema.node('paragraph',null,schema.text(text));
  const item=(text:string,nested?:any)=>schema.node('list_item',null,[p(text),...(nested?[nested]:[])]);
  const doc=identifiedDocument(schema.node('doc',null,schema.node('ordered_list',{listTemplate:defaultListTemplate(),order:3},[item('Main',schema.node('ordered_list',null,[item('Nested')])),item('Last')])));
  let state=EditorState.create({doc,selection:TextSelection.create(doc,3),plugins:[history(),blockIdentities()]});
  const template=defaultListTemplate();template[level].format='square';template[level].pattern='▪';
  let operation:any;setListTemplate(template,3,false)(state,tr=>operation=tr);
  state=state.applyTransaction(trackReviewTransaction(state,operation,stamp)).state;
  expect(reviewChanges(state.doc)).toHaveLength(1);expect(reviewedDocument(state.doc,'original').eq(doc)).toBe(true);
  const target=level===0?state.doc.firstChild!:state.doc.firstChild!.firstChild!.lastChild!;
  expect(target.type.name).toBe('bullet_list');
  const final=reviewedDocument(state.doc,'final');
  for(const decision of ['accept','reject'] as const)expect(state.applyTransaction(resolveReviewChanges(state,new Set([stamp.id]),decision)).state.doc.eq(decision==='accept'?final:doc)).toBe(true);
  undo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(doc)).toBe(true);
});
it.each(['ordered_list','bullet_list'] as const)('tracks converting %s with stable item selection and history',kind=>{
  const other=kind==='ordered_list'?'bullet_list':'ordered_list';
  const p=schema.node('paragraph',null,schema.text('Item wording'));
  const doc=identifiedDocument(schema.node('doc',null,schema.node(kind,{order:7,listStyle:kind==='ordered_list'?'upper-roman':'square'},[schema.node('list_item',null,[p,p]),schema.node('list_item',null,p)])));
  let state=EditorState.create({doc,selection:TextSelection.create(doc,3,7),plugins:[history(),blockIdentities()]});
  let operation:any;expect(toggleList(other)(state,tr=>operation=tr)).toBe(true);
  state=state.applyTransaction(trackReviewTransaction(state,operation,stamp)).state;
  expect(state.doc.firstChild!.type.name).toBe(other);expect(state.doc.firstChild!.attrs.blockId).toBe(doc.firstChild!.attrs.blockId);
  expect(state.selection.from).toBe(3);expect(state.selection.to).toBe(7);expect(reviewChanges(state.doc)).toHaveLength(1);
  const final=reviewedDocument(state.doc,'final');expect(reviewedDocument(state.doc,'original').eq(doc)).toBe(true);
  const html=document.createElement('div');html.append(DOMSerializer.fromSchema(schema).serializeFragment(state.doc.content));
  const copied=schema.node('doc',null,clipboardSlice(schema,'',html.innerHTML,'source').content);
  expect(reviewedDocument(copied,'original').firstChild!.type.name).toBe(kind);expect(reviewedDocument(copied,'final').firstChild!.type.name).toBe(other);
  for(const decision of ['accept','reject'] as const){
    const result=state.applyTransaction(resolveReviewChanges(state,new Set([stamp.id]),decision)).state.doc;
    expect(result.eq(decision==='accept'?final:doc)).toBe(true);
  }
  const pending=state.doc;undo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(doc)).toBe(true);redo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(pending)).toBe(true);
});
it.each(['ordinary','bullets','outline','continued'])('retains %s list appearance through review, copying and history',kind=>{
  const p=(text:string)=>schema.node('paragraph',null,schema.text(text));
  const list=(text:string,continuation=false)=>schema.node(kind==='bullets'?'bullet_list':'ordered_list',{order:1,continuePrevious:continuation},[schema.node('list_item',null,[p(text+' first'),p('Continuation')]),schema.node('list_item',null,p(text+' second'))]);
  const doc=identifiedDocument(schema.node('doc',null,[list('Main'),...(kind==='continued'?[p('Gap'),list('Later',true)]:[])]));
  let state=EditorState.create({doc,selection:TextSelection.create(doc,3),plugins:[history(),blockIdentities(),continuedLists()]});
  // Initial continuation order is a derived property.
  if(kind==='continued')state=state.applyTransaction(state.tr.insertText('',3)).state;
  const original=state.doc;
  let operation:any;const template=defaultListTemplate();template[0].format='upper-roman';
  const command=kind==='outline'?setListTemplate(template,7,false):setListFormatting(kind==='bullets'?'square':'upper-roman',7);
  command(state,tr=>operation=tr);
  state=state.applyTransaction(trackReviewTransaction(state,operation,stamp)).state;
  expect(reviewChanges(state.doc)).toHaveLength(1);expect(reviewChanges(state.doc)[0].ranges[0].text).toMatch(/^List:/);
  const base=reviewedDocument(state.doc,'original'),final=reviewedDocument(state.doc,'final');
  expect(base.firstChild!.attrs.order).toBe(1);expect(final.firstChild!.attrs.order).toBe(kind==='bullets'?1:7);
  if(kind==='continued')expect(final.lastChild!.attrs.order).toBe(1); // Different marker starts a new sequence.
  const html=document.createElement('div');html.append(DOMSerializer.fromSchema(schema).serializeFragment(state.doc.content));
  const copied=schema.node('doc',null,clipboardSlice(schema,'',html.innerHTML,'source').content);
  expect(reviewChanges(copied)).toHaveLength(1);expect(reviewedDocument(copied,'original').firstChild!.attrs.listTemplate).toBeNull();
  for(const decision of ['accept','reject'] as const){const result=state.applyTransaction(resolveReviewChanges(state,new Set([stamp.id]),decision)).state.doc;expect(reviewedDocument(result,'final').eq(decision==='accept'?final:base)).toBe(true);}
  const pending=state.doc;undo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.firstChild!.eq(original.firstChild!)).toBe(true);redo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(pending)).toBe(true);
  state=state.applyTransaction(trackReviewTransaction(state,state.tr.insertText('New ',3),{...stamp,id:'wording'})).state;
  expect(reviewChanges(state.doc)).toHaveLength(2);
  state=state.applyTransaction(resolveReviewChanges(state,new Set([stamp.id]),'reject')).state;
  expect(reviewChanges(state.doc)).toHaveLength(1);expect(state.doc.textContent).toContain('New Main first');expect(state.doc.firstChild!.attrs.listTemplate).toBeNull();
});
