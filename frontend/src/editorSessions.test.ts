// @vitest-environment jsdom
import {it,expect} from 'vitest';
import {Schema} from 'prosemirror-model';
import {EditorState,TextSelection,Plugin} from 'prosemirror-state';
import {history,undo,redo} from 'prosemirror-history';
import {captureEditorSessions,editorSession,forgetEditorSessions,registerEditorSession,rememberEditorSession} from './editorSessions';
const schema=new Schema({nodes:{doc:{content:'paragraph+'},paragraph:{content:'text*'},text:{}}});
const initial=()=>EditorState.create({doc:schema.node('doc',null,schema.node('paragraph',null,schema.text('Original'))),plugins:[history(),new Plugin({})]});
it('keeps caret and undo when switching views without retaining view plugins',()=>{
  let state=initial();const tr=state.tr.insertText('New ',1);state=state.apply(tr.setSelection(TextSelection.create(tr.doc,5)));
  const release=registerEditorSession('switch','switch:chapter',()=>state);release(state);
  let restored=editorSession('switch:chapter')!;expect(restored.selection.from).toBe(5);expect(restored.plugins).toHaveLength(1);
  expect(undo(restored,tr=>restored=restored.apply(tr))).toBe(true);expect(restored.doc.textContent).toBe('Original');
  expect(redo(restored,tr=>restored=restored.apply(tr))).toBe(true);expect(restored.doc.textContent).toBe('New Original');
  forgetEditorSessions('switch');
});
it('releases only a closed project and prevents its delayed unmount from recaching it',()=>{
  const state=initial();rememberEditorSession('closed:write',state);rememberEditorSession('closed:sandbox',state);rememberEditorSession('closed-other:write',state);
  const release=registerEditorSession('closed','closed:write',()=>state);
  forgetEditorSessions('closed');expect(captureEditorSessions('closed').size).toBe(0);release(state);
  expect(editorSession('closed:write')).toBeUndefined();expect(editorSession('closed:sandbox')).toBeUndefined();expect(editorSession('closed-other:write')).toBeDefined();
  forgetEditorSessions('closed-other');
});
it('allows reopening while an older view is still awaiting cleanup',()=>{
  const old=initial(),fresh=old.apply(old.tr.insertText('Current ',1));
  const previous=registerEditorSession('reopened','reopened:write',()=>old);forgetEditorSessions('reopened');
  const release=registerEditorSession('reopened','reopened:write',()=>fresh);previous(old);
  expect(captureEditorSessions('reopened').get('reopened:write')!.doc.eq(fresh.doc)).toBe(true);
  release(fresh);expect(editorSession('reopened:write')!.doc.eq(fresh.doc)).toBe(true);forgetEditorSessions('reopened');
});
