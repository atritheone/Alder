// @vitest-environment jsdom
import { it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import { DOMSerializer } from "prosemirror-model";
import { history, undo, redo } from "prosemirror-history";
import { schema } from "./Editor";
import { identifiedDocument, blockIdentities } from "./blockIdentities";
import { moveOutlineSection } from "./documentOutline";
import { trackReviewTransaction, reviewedDocument, resolveReviewChanges } from "./trackedReview";
import { validateReviewMoves } from "./trackedMoves";
import { clipboardSlice } from "./pasteText";
import { documentNotes, noteReferenceNumbers } from "./documentNotes";
import { speechText } from "./speechText";
import { pageReferenceTransaction } from "./pageReferences";

it.each([['table','equation'],['table','shape'],['table','inline_image'],['table','document_note'],['table','document_field'],['table','form_field'],['table','text_box'],['ordered_list','equation'],['ordered_list','shape'],['ordered_list','inline_image'],['ordered_list','document_note'],['ordered_list','document_field'],['ordered_list','form_field'],['ordered_list','text_box']])(
  'retains editable %s/%s objects and identities through a section move', (container,kind) => {
    const object = kind==='form_field' ? schema.node('form_field',{blockId:'object',kind:'rich',label:'Moved field',lockContent:true,lockDelete:true},schema.text('Field value',[schema.marks.strong.create()])) : kind==='text_box' ? schema.node('text_box',{blockId:'object',width:180,fill:'#c9d8e8'},[schema.text('First line',[schema.marks.strong.create()]),schema.node('hard_break'),schema.text('Last line',[schema.marks.em.create()])]) : kind==='document_field' ? schema.node('document_field',{blockId:'object',fieldKind:'page'},schema.text('2'),[schema.marks.strong.create()]) : kind==='document_note' ? schema.node('document_note',{blockId:'object',kind:'footnote',body:{type:'doc',content:[{type:'paragraph',attrs:{blockId:'body'},content:[{type:'text',text:'Moved note',marks:[{type:'strong'}]}]}]}}) : kind==='inline_image' ? schema.node('inline_image',{blockId:'object',src:'/api/projects/test/assets/picture',assetId:'picture',width:96,alt:'Illustration',crop:{left:10,right:0,top:0,bottom:0}}) : kind==='shape' ? schema.node('shape',{blockId:'object',kind:'arrow',width:80,height:40,alt:'Direction',fill:'#c9d8e8'}) : schema.node('equation',{blockId:'object',mathML:'<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>'},schema.text('fraction a over b end fraction'));
    const p=schema.node('paragraph',null,[schema.text('Before '),object,schema.text(' after.')]);
    const block=container==='table' ? schema.node('table',null,schema.node('table_row',null,schema.node('table_cell',null,p))) : schema.node('ordered_list',{order:3},schema.node('list_item',null,p));
    const before=identifiedDocument(schema.node('doc',null,[schema.node('heading',{level:1,blockId:'first'},schema.text('First')),block,schema.node('heading',{level:1,blockId:'second'},schema.text('Second')),schema.node('paragraph',null,schema.text('Other section'))]));
    let state=EditorState.create({doc:before,plugins:[history(),blockIdentities()]});
    const move=moveOutlineSection(state,'first','second',true)!;
    const after=state.applyTransaction(move).state.doc;
    state=state.applyTransaction(trackReviewTransaction(state,move,{id:'object_move',author:'Reviewer',date:''})).state;
    const pending=state.doc;validateReviewMoves(pending);
    const objects: string[]=[];pending.descendants(n=>{if(n.type.name===kind)objects.push(n.attrs.blockId);});
    expect(new Set(objects).size).toBe(2);expect(objects).toContain('object');
    if(kind==='document_note'){
      expect(documentNotes(pending)).toHaveLength(1);
      expect(noteReferenceNumbers(pending).map(ref=>ref.number)).toEqual(['1','1']);
      expect(speechText(pending,0,undefined,true).text).toBe(speechText(after,0,undefined,true).text);
    }
    expect(reviewedDocument(pending,'original').eq(before)).toBe(true);
    expect(reviewedDocument(pending,'final').eq(after)).toBe(true);
    for(const decision of ['accept','reject'] as const)
      expect(state.applyTransaction(resolveReviewChanges(state,new Set(['object_move']),decision)).state.doc.eq(decision==='accept'?after:before)).toBe(true);
    undo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(before)).toBe(true);
    redo(state,tr=>state=state.applyTransaction(tr).state);expect(state.doc.eq(pending)).toBe(true);
    const html=document.createElement('div');html.append(DOMSerializer.fromSchema(schema).serializeFragment(pending.content));
    if(kind==='inline_image'){
      expect(()=>clipboardSlice(schema,'',html.innerHTML,'source')).toThrow(/could not be collected/);
      return;
    }
    const pasted=schema.node('doc',null,clipboardSlice(schema,'',html.innerHTML,'source').content);validateReviewMoves(pasted);
    expect(reviewedDocument(pasted,'final').textContent).toBe(after.textContent);
    if(kind==='document_field'){
      const values=Object.fromEntries(objects.map(id=>[id,id==='object'?'10':'1']));
      const refreshed=state.applyTransaction(pageReferenceTransaction(state,{references:{},fields:values,pages:10})!).state;
      validateReviewMoves(refreshed.doc);
      for(const [decision,expected] of [['accept','10'],['reject','1']] as const){
        const result=refreshed.applyTransaction(resolveReviewChanges(refreshed,new Set(['object_move']),decision)).state.doc;
        const values:string[]=[];result.descendants(n=>{if(n.type.name==='document_field')values.push(n.textContent);});
        expect(values).toEqual([expected]);
      }
    }
  },
);
