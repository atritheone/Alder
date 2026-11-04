// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { CellSelection, TableMap } from 'prosemirror-tables';
import { DOMSerializer } from 'prosemirror-model';
import { history, undo, redo } from 'prosemirror-history';
import { schema } from './Editor';
import { identifiedDocument, blockIdentities } from './blockIdentities';
import { trackReviewTransaction, reviewedDocument, resolveReviewChanges, reviewChanges } from './trackedReview';
import { validateReviewMoves } from './trackedMoves';
import { clipboardSlice } from './pasteText';
import { moveTableRows } from './tableStructure';
import { documentComments } from './documentComments';
const stamp={id:'row-move',author:'Reviewer',date:''};
const p=(text:string)=>schema.node('paragraph',null,schema.text(text));
const cell=(text:string,rowspan=1)=>schema.node('table_cell',{rowspan},p(text));
const row=(text:string)=>schema.node('table_row',null,[cell(text),cell(text+' right')]);

it.each([-1,1] as const)('moves complete merged bands with stable identities, review, copy and history (%s)',direction=>{
  const band=[schema.node('table_row',null,[cell('Merged',2),cell('Upper right')]),schema.node('table_row',null,[cell('Lower right')])];
  const doc=identifiedDocument(schema.node('doc',null,schema.node('table',null,[row('First'),...band,row('Last')])));
  const map=TableMap.get(doc.firstChild!);
  let state=EditorState.create({doc,selection:CellSelection.create(doc,1+map.map[3]),plugins:[history(),blockIdentities()]});
  let source:any;expect(moveTableRows(direction)(state,tr=>source=tr)).toBe(true);
  state=state.applyTransaction(trackReviewTransaction(state,source,stamp)).state;
  validateReviewMoves(state.doc);expect(reviewChanges(state.doc)).toHaveLength(1);
  expect(state.selection instanceof CellSelection).toBe(true);
  expect(state.selection.$from.node(-1).attrs.revisionMove.kind).toBe('insertion');
  expect(reviewedDocument(state.doc,'original').eq(doc)).toBe(true);
  expect(reviewedDocument(state.doc,'final').eq(source.doc)).toBe(true);
  expect(TableMap.get(state.doc.firstChild!).problems).toBeNull();
  const ids:string[]=[];state.doc.descendants(n=>{if(n.attrs.blockId)ids.push(n.attrs.blockId);});expect(new Set(ids).size).toBe(ids.length);
  const html=document.createElement('div');html.append(DOMSerializer.fromSchema(schema).serializeFragment(state.doc.content));
  const copied=schema.node('doc',null,clipboardSlice(schema,'',html.innerHTML,'source').content);validateReviewMoves(copied);
  for(const decision of ['accept','reject'] as const){
    const result=state.applyTransaction(resolveReviewChanges(state,new Set([stamp.id]),decision)).state.doc;
    expect(result.eq(decision==='accept'?source.doc:doc)).toBe(true);
  }
  const pending=state.doc;undo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(doc)).toBe(true);
  redo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(pending)).toBe(true);
});

it('moves nested rows and refuses malformed partial or separated pairs',()=>{
  const inner=schema.node('table',null,[row('One'),row('Two'),row('Three')]);
  const doc=identifiedDocument(schema.node('doc',null,schema.node('table',null,schema.node('table_row',null,schema.node('table_cell',null,[p('Outer'),inner])))));
  let start=0;doc.descendants((n,pos)=>{if(n.type.name==='table'&&n.childCount===3)start=pos+1;});
  const nested=doc.nodeAt(start-1)!,map=TableMap.get(nested);
  let state=EditorState.create({doc,selection:CellSelection.create(doc,start+map.map[2]),plugins:[blockIdentities()]});
  let source:any;moveTableRows(1)(state,tr=>source=tr);state=state.applyTransaction(trackReviewTransaction(state,source,stamp)).state;
  validateReviewMoves(state.doc);expect(reviewedDocument(state.doc,'final').eq(source.doc)).toBe(true);
  let ghost=0;state.doc.descendants((n,pos)=>{if(n.type.name==='table_row'&&n.attrs.revisionMove?.kind==='deletion')ghost=pos;});
  const broken=state.tr.delete(ghost,ghost+state.doc.nodeAt(ghost)!.nodeSize).doc;
  expect(()=>validateReviewMoves(broken)).toThrow();
});

it('keeps one live comment and unrelated pending rows while moving a clean row',()=>{
  const thread={resolved:false,entries:[{id:'entry',author:'Reader',text:'Keep this range.',date:''}]};
  const anchor=(edge:string)=>schema.node('comment_anchor',{threadId:'comment',edge,thread});
  const commented=schema.node('table_row',null,[schema.node('table_cell',null,schema.node('paragraph',null,[anchor('start'),schema.text('Moved')])),schema.node('table_cell',null,schema.node('paragraph',null,[schema.text('range'),anchor('end')]))]);
  const pending=row('Unrelated');
  const inserted=pending.type.create({...pending.attrs,revisionBlock:{kind:'insertion',originalId:'unrelated',stamp:{id:'unrelated',author:'Other',date:''}},blockId:'unrelated'},pending.content);
  const doc=identifiedDocument(schema.node('doc',null,schema.node('table',null,[row('First'),commented,row('Next'),inserted])));
  const map=TableMap.get(doc.firstChild!);let state=EditorState.create({doc,selection:CellSelection.create(doc,1+map.map[2]),plugins:[blockIdentities()]});
  moveTableRows(1)(state,tr=>state=state.applyTransaction(trackReviewTransaction(state,tr,stamp)).state);
  validateReviewMoves(state.doc);expect(documentComments(state.doc)).toHaveLength(1);expect(documentComments(state.doc)[0].anchors).toHaveLength(4);
  expect(reviewChanges(state.doc)).toHaveLength(2);
  for(const decision of ['accept','reject'] as const){
    const result=state.applyTransaction(resolveReviewChanges(state,new Set([stamp.id]),decision)).state.doc;
    expect(documentComments(result)).toHaveLength(1);expect(documentComments(result)[0].anchors).toHaveLength(2);
    expect(reviewChanges(result).map(c=>c.id)).toEqual(['unrelated']);
  }
});
