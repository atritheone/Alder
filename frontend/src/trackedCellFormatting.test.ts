// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {EditorState} from 'prosemirror-state';
import {history,undo,redo} from 'prosemirror-history';
import {DOMSerializer} from 'prosemirror-model';
import {CellSelection} from 'prosemirror-tables';
import {schema} from './Editor';
import {identifiedDocument,blockIdentities} from './blockIdentities';
import {setTableProperties,sizeTableColumns} from './tableFormatting';
import {trackReviewTransaction,reviewedDocument,reviewChanges,resolveReviewChanges} from './trackedReview';
import {clipboardSlice} from './pasteText';
const stamp={id:'cell-style',author:'Reviewer',date:''};
it.each([false,true])('tracks column resizing as one shared formatting decision (automatic=%s)',automatic=>{
  const cell=(text:string,width:number)=>schema.node('table_cell',{colwidth:automatic?null:[width]},schema.node('paragraph',null,schema.text(text)));
  const row=()=>schema.node('table_row',null,[cell('Left',200),cell('Right',240)]);
  const doc=identifiedDocument(schema.node('doc',null,schema.node('table',null,[row(),row()])));
  let state=EditorState.create({doc,selection:new CellSelection(doc.resolve(2)),plugins:[history(),blockIdentities()]});
  let operation:any;expect(sizeTableColumns([120,320])(state,tr=>operation=tr)).toBe(true);
  state=state.applyTransaction(trackReviewTransaction(state,operation,stamp)).state;
  expect(reviewChanges(state.doc)).toHaveLength(1);
  expect(reviewedDocument(state.doc,'original').eq(doc)).toBe(true);
  expect(reviewedDocument(state.doc,'final').eq(operation.doc)).toBe(true);
  for(const decision of ['accept','reject'] as const){
    const resolved=state.applyTransaction(resolveReviewChanges(state,new Set([stamp.id]),decision)).state.doc;
    expect(resolved.eq(decision==='accept'?operation.doc:doc)).toBe(true);
  }
  const pending=state.doc;undo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(doc)).toBe(true);
  redo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(pending)).toBe(true);
});
it.each([false,true])('retains selected table, row and cell appearance through review, copying and history (table=%s)',wholeTable=>{
  const cell=(text:string)=>schema.node('table_cell',null,schema.node('paragraph',null,schema.text(text)));
  const doc=identifiedDocument(schema.node('doc',null,schema.node('table',null,schema.node('table_row',null,[cell('Left'),cell('Right')]))));
  let state=EditorState.create({doc,selection:new CellSelection(doc.resolve(2),doc.resolve(2+doc.firstChild!.firstChild!.firstChild!.nodeSize)),plugins:[history(),blockIdentities()]});
  let operation:any;setTableProperties(doc.firstChild!.attrs.blockId,{table:wholeTable?{align:'right'}:{},rows:wholeTable?{minHeight:64,allowSplit:true}:{},cells:{background:'#d6e2ef',paddingTop:12,paddingBottom:9,borderWidth:1.5,verticalAlign:'bottom'}})(state,tr=>operation=tr);
  state=state.applyTransaction(trackReviewTransaction(state,operation,stamp)).state;
  expect(reviewChanges(state.doc)).toHaveLength(1);expect(reviewChanges(state.doc)[0].ranges.every(r=>/^(Cell|Row|Table):/.test(r.text))).toBe(true);
  expect(reviewedDocument(state.doc,'original').eq(doc)).toBe(true);expect(reviewedDocument(state.doc,'final').eq(operation.doc)).toBe(true);
  const html=document.createElement('div');html.append(DOMSerializer.fromSchema(schema).serializeFragment(state.doc.content));
  const copied=schema.node('doc',null,clipboardSlice(schema,'',html.innerHTML,'source').content);
  expect(reviewChanges(copied)).toHaveLength(1);expect(reviewedDocument(copied,'original').firstChild!.firstChild!.firstChild!.attrs.background).toBeNull();
  for(const decision of ['accept','reject'] as const){const result=state.applyTransaction(resolveReviewChanges(state,new Set([stamp.id]),decision)).state.doc;expect(result.eq(decision==='accept'?operation.doc:doc)).toBe(true);}
  const pending=state.doc;undo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(doc)).toBe(true);redo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(pending)).toBe(true);
  state=state.applyTransaction(trackReviewTransaction(state,state.tr.insertText('New ',4),{...stamp,id:'wording'})).state;
  expect(reviewChanges(state.doc)).toHaveLength(2);
  state=state.applyTransaction(resolveReviewChanges(state,new Set([stamp.id]),'reject')).state;
  expect(reviewChanges(state.doc)).toHaveLength(1);expect(state.doc.textContent).toBe('New LeftRight');
  expect(state.doc.firstChild!.firstChild!.firstChild!.attrs.background).toBeNull();
});
