// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { EditorState, Plugin, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history, undo, redo } from 'prosemirror-history';
import { schema } from './Editor';
import { directTyping } from './directTyping';
import { caseInputPlugin } from './caseTransform';

const views:EditorView[]=[];
afterEach(()=>{for(const view of views.splice(0))view.destroy();document.body.replaceChildren();});
function fixture(extra:Plugin[]=[]) {
  const typing=directTyping(),doc=schema.node('doc',null,[schema.node('paragraph',null,schema.text('Alpha beta'))]);
  const host=document.body.appendChild(document.createElement('div'));
  const view=new EditorView(host,{state:EditorState.create({doc,selection:TextSelection.create(doc,6),plugins:[typing,history(),...extra]})});views.push(view);
  const call=(name:string,event:any)=>(typing.props.handleDOMEvents as any)[name](view,event);
  const key=(text='x',changes={})=>call('keydown',{key:text,keyCode:text.charCodeAt(0),isTrusted:true,defaultPrevented:false,...changes});
  const input=(text='x',changes={})=>{
    const from=view.domAtPos(view.state.selection.from),to=view.domAtPos(view.state.selection.to);
    const event={isTrusted:true,cancelable:true,defaultPrevented:false,isComposing:false,inputType:'insertText',data:text,
      getTargetRanges:()=>[{startContainer:from.node,startOffset:from.offset,endContainer:to.node,endOffset:to.offset}],
      preventDefault(){this.defaultPrevented=true;},...changes};
    return {handled:call('beforeinput',event),prevented:event.defaultPrevented};
  };
  return {view,key,input,call};
}

it('retains marks, input hooks, case normalization and a single undo group',()=>{
  const calls:string[]=[];
  const hook=new Plugin({props:{handleTextInput(_v,_from,_to,text){calls.push(text);return false;}}});
  const {view,key,input}=fixture([hook,caseInputPlugin(()=> 'upper')]);
  view.dispatch(view.state.tr.addStoredMark(schema.marks.strong.create()));
  for(const c of 'word'){key(c);expect(input(c)).toEqual({handled:true,prevented:true});}
  expect(view.state.doc.textContent).toBe('AlphaWORD beta');expect(calls.join('')).toBe('word');
  expect(view.state.doc.firstChild!.child(1).marks.map(m=>m.type.name)).toContain('strong');
  undo(view.state,view.dispatch);expect(view.state.doc.textContent).toBe('Alpha beta');
  redo(view.state,view.dispatch);expect(view.state.doc.textContent).toBe('AlphaWORD beta');
});

it('replaces only the matching selected range',()=>{
  const {view,key,input}=fixture();view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,1,6)));
  key();expect(input().handled).toBe(true);expect(view.state.doc.textContent).toBe('x beta');
});

it.each([
  ['composition',{isComposing:true},{}],['IME key',{keyCode:229},{}],['dead key',{key:'Dead'},{}],
  ['shortcut',{ctrlKey:true},{}],['option key',{altKey:true},{}],['non-ASCII key',{key:'é'},{}],
  ['untrusted key',{isTrusted:false},{}],['composition input',{}, {isComposing:true}],
  ['replacement input',{}, {inputType:'insertReplacementText'}],['dictated input',{}, {data:'several words'}],
  ['uncancelable input',{}, {cancelable:false}],['synthetic input',{}, {isTrusted:false}],
  ['no target range',{}, {getTargetRanges:()=>[]}],['handled input',{}, {defaultPrevented:true}],
])('leaves %s to the existing input path',(_name,keyChanges,inputChanges)=>{
  const {view,key,input}=fixture();const before=view.state.doc;key('x',keyChanges);
  expect(input('x',inputChanges).handled).toBe(false);expect(view.state.doc).toBe(before);
});

it('does not overwrite a changed selection or a different native target',()=>{
  const {view,key,input}=fixture();key();view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,2)));
  expect(input().handled).toBe(false);key();expect(input('x',{getTargetRanges:()=>[{startContainer:document.body,startOffset:0,endContainer:document.body,endOffset:0}]}).handled).toBe(false);
});

it('honors content guards and consumes only one input per matching key',()=>{
  const {view,key,input}=fixture([new Plugin({filterTransaction:tr=>!tr.docChanged})]);
  key();expect(input().handled).toBe(true);expect(view.state.doc.textContent).toBe('Alpha beta');expect(input().handled).toBe(false);
});
