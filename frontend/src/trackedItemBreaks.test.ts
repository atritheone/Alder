// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { splitListItem } from 'prosemirror-schema-list';
import { joinBackward } from 'prosemirror-commands';
import { history, undo, redo, closeHistory } from 'prosemirror-history';
import { DOMSerializer } from 'prosemirror-model';
import { schema } from './Editor';
import { blockIdentities, identifiedDocument } from './blockIdentities';
import { trackReviewTransaction, reviewedDocument, resolveReviewChanges, reviewChanges } from './trackedReview';
import { clipboardSlice } from './pasteText';
const stamp = { id: 'item-split', author: 'Writer', date: '' };
const p = (text: string) => schema.node('paragraph', { align: 'justify' }, schema.text(text));
const item = (text: string) => schema.node('list_item', null, p(text));
function initial(container: string) {
  const list = schema.node('ordered_list', { order: 3 }, [schema.node('list_item', null, [p('First words'), p('Continuation'), schema.node('bullet_list', null, item('Nested'))]), item('Second words')]);
  const body = container === 'cell' ? schema.node('table', null, schema.node('table_row', null, schema.node('table_cell', null, list))) :
    container === 'nested' ? schema.node('bullet_list', null, schema.node('list_item', null, [p('Outer'), list])) : list;
  const doc = identifiedDocument(schema.node('doc', null, body)); let at = 0;
  doc.descendants((node, pos) => { if (node.isTextblock && node.textContent === (container === 'continuation' ? 'Continuation' : 'First words')) at = pos + 6; });
  return EditorState.create({ doc, selection: TextSelection.create(doc, at), plugins: [history(), blockIdentities()] });
}
it.each(['body', 'nested', 'cell', 'continuation'])('tracks an authored item split with continuation content, clipboard and history (%s)', container => {
  let state = initial(container); const before = state.doc; let source: any;
  expect(splitListItem(schema.nodes.list_item)(state, tr => source = tr)).toBe(true);
  state = state.applyTransaction(trackReviewTransaction(state, source, stamp)).state;
  const pending = state.doc, final = reviewedDocument(pending, 'final');
  expect(reviewChanges(pending)).toHaveLength(1); expect(reviewChanges(pending)[0].ranges[0].text).toBe('List item break');
  expect(reviewedDocument(pending, 'original').eq(before)).toBe(true);
  for (const decision of ['accept', 'reject'] as const) {
    const decided = state.applyTransaction(resolveReviewChanges(state, new Set([stamp.id]), decision)).state;
    expect(decided.doc.eq(decision === 'accept' ? final : before)).toBe(true);
  }
  const host = document.createElement('div'); host.append(DOMSerializer.fromSchema(schema).serializeFragment(pending.content));
  const copy = schema.node('doc', null, clipboardSlice(schema, '', host.innerHTML, 'source').content);
  expect(reviewChanges(copy)).toHaveLength(1); expect(reviewedDocument(copy, 'original').textContent).toBe(before.textContent);
  undo(state, tr => state = state.applyTransaction(tr).state); expect(state.doc.eq(before)).toBe(true);
  redo(state, tr => state = state.applyTransaction(tr).state); expect(state.doc.eq(pending)).toBe(true);
});

it('rejects only the boundary while preserving later independently reviewed wording', () => {
  let state = initial('body'); let source: any;
  splitListItem(schema.nodes.list_item)(state, tr => source = tr);
  state = state.applyTransaction(trackReviewTransaction(state, source, stamp)).state;
  state = state.applyTransaction(trackReviewTransaction(state, closeHistory(state.tr).insertText('added '), { ...stamp, id: 'typing' })).state;
  expect(reviewChanges(state.doc)).toHaveLength(2);
  state = state.applyTransaction(resolveReviewChanges(state, new Set([stamp.id]), 'reject')).state;
  expect(state.doc.firstChild!.firstChild!.firstChild!.textContent).toBe('Firstadded  words');
  expect(reviewChanges(state.doc).map(change => change.id)).toEqual(['typing']);
  expect(reviewedDocument(state.doc, 'original').textContent).toBe('First wordsContinuationNestedSecond words');
});

it.each(['body', 'nested', 'cell'])('tracks Backspace joining items while retaining paragraph, nested content, copy and undo (%s)', container => {
  let state = initial(container), at = 0;
  // Use the first two paragraphs as separate items so a natural Backspace
  // merges only the containers, not the paragraph or any following sublist.
  state.doc.descendants((node, pos) => { if (node.type.name === 'list_item' && node.firstChild?.textContent === 'First words') at = pos; });
  const originalItem = state.doc.nodeAt(at)!;
  state = state.apply(state.tr.replaceWith(at, at + originalItem.nodeSize, [
    schema.node('list_item', originalItem.attrs, originalItem.firstChild!),
    schema.node('list_item', null, originalItem.content.cut(originalItem.firstChild!.nodeSize)),
  ]));
  state = EditorState.create({ doc: identifiedDocument(state.doc), plugins: [history(), blockIdentities()] });
  state.doc.descendants((node, pos) => { if (node.isTextblock && node.textContent === 'Continuation') at = pos + 1; });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
  const before = state.doc; let source: any;
  expect(joinBackward(state, tr => source = tr)).toBe(true);
  state = state.applyTransaction(trackReviewTransaction(state, source, stamp)).state;
  const pending = state.doc, final = reviewedDocument(pending, 'final');
  expect(reviewChanges(pending)).toHaveLength(1); expect(reviewedDocument(pending, 'original').eq(before)).toBe(true);
  expect(final.textContent).toBe(before.textContent);
  for (const decision of ['accept', 'reject'] as const)
    expect(state.applyTransaction(resolveReviewChanges(state, new Set([stamp.id]), decision)).state.doc.eq(decision === 'accept' ? final : before)).toBe(true);
  const host = document.createElement('div'); host.append(DOMSerializer.fromSchema(schema).serializeFragment(pending.content));
  const copied = schema.node('doc', null, clipboardSlice(schema, '', host.innerHTML, 'source').content);
  expect(reviewedDocument(copied, 'original').textContent).toBe(before.textContent);
  expect(reviewChanges(copied)).toHaveLength(1);
  undo(state, tr => state = state.applyTransaction(tr).state); expect(state.doc.eq(before)).toBe(true);
  redo(state, tr => state = state.applyTransaction(tr).state); expect(state.doc.eq(pending)).toBe(true);
});
