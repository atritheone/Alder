// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { DOMSerializer } from 'prosemirror-model';
import { history, undo, redo } from 'prosemirror-history';
import { schema } from './Editor';
import { identifiedDocument, blockIdentities } from './blockIdentities';
import { deleteListItems, insertListItem } from './trackedListItems';
import { trackReviewTransaction, reviewedDocument, reviewChanges, resolveReviewChanges } from './trackedReview';
import { clipboardSlice } from './pasteText';
const stamp = { id: 'list-change', author: 'Writer', date: '' };
const p = (text: string) => schema.node('paragraph', null, schema.text(text));
const listing = () => schema.node('ordered_list', { order: 3 }, [schema.node('list_item', null, [p('First'), p('Continuation'), schema.node('bullet_list', null, schema.node('list_item', null, p('Nested')))]), schema.node('list_item', null, p('Last'))]);

it.each(['body', 'only', 'nested', 'cell'])('deletes a complete list, preserving its container and review history (%s)', container => {
  const list = listing(), body = container === 'cell' ? schema.node('table', null, schema.node('table_row', null, schema.node('table_cell', null, list))) : container === 'nested' ? schema.node('bullet_list', null, schema.node('list_item', null, [p('Outer'), list])) : list;
  const doc = identifiedDocument(schema.node('doc', null, container === 'body' ? [body, p('After')] : [body])); let at = 0;
  doc.descendants((n, pos) => { if (n.type.name === 'ordered_list') at = pos; });
  let state = EditorState.create({ doc, selection: TextSelection.create(doc, at + 3, at + list.nodeSize - 3), plugins: [history(), blockIdentities()] }), source: any;
  expect(deleteListItems(state, tr => source = tr)).toBe(true);
  state = state.applyTransaction(trackReviewTransaction(state, source, stamp)).state;
  const pending = state.doc;
  expect(reviewChanges(pending)).toHaveLength(1);
  expect(reviewedDocument(pending, 'original').eq(doc)).toBe(true);
  expect(reviewedDocument(pending, 'final').eq(source.doc)).toBe(true);
  for (const decision of ['accept', 'reject'] as const)
    expect(JSON.stringify(state.applyTransaction(resolveReviewChanges(state, new Set([stamp.id]), decision)).state.doc.toJSON(), (key, value) => key === 'blockId' ? undefined : value))
      .toBe(JSON.stringify((decision === 'accept' ? source.doc : doc).toJSON(), (key, value) => key === 'blockId' ? undefined : value));
  const host = document.createElement('div'); host.append(DOMSerializer.fromSchema(schema).serializeFragment(pending.content));
  const copied = schema.node('doc', null, clipboardSlice(schema, '', host.innerHTML, 'source').content);
  expect(reviewChanges(copied)).toHaveLength(1);
  undo(state, tr => state = state.applyTransaction(tr).state); expect(state.doc.eq(doc)).toBe(true);
  redo(state, tr => state = state.applyTransaction(tr).state); expect(state.doc.eq(pending)).toBe(true);
});

it('a newly inserted list owns text and new items and can be cancelled', () => {
  const doc = identifiedDocument(schema.node('doc', null, p('Anchor')));
  let state = EditorState.create({ doc, plugins: [history(), blockIdentities()] });
  state = state.applyTransaction(trackReviewTransaction(state, state.tr.insert(0, listing()), stamp)).state;
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)));
  const dispatch = (tr: any) => { state = state.applyTransaction(trackReviewTransaction(state, tr, { ...stamp, id: 'later' })).state; };
  dispatch(state.tr.insertText('Added ')); insertListItem(1)(state, dispatch);
  expect(reviewChanges(state.doc)).toHaveLength(1); expect(reviewedDocument(state.doc, 'original').eq(doc)).toBe(true);
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3, state.doc.firstChild!.nodeSize - 3)));
  const pending = state.doc; deleteListItems(state, dispatch);
  expect(state.doc.eq(doc)).toBe(true);
  undo(state, tr => state = state.applyTransaction(tr).state); expect(state.doc.eq(pending)).toBe(true);
});

it('pastes a complete list into an empty document with one reversible insertion', () => {
  let state = EditorState.create({ schema });
  const source = state.tr.replaceSelection(clipboardSlice(schema, '', '<ol><li><p>First</p></li><li><p>Last</p></li></ol>', 'source'));
  state = state.applyTransaction(trackReviewTransaction(state, source, stamp)).state;
  expect(reviewChanges(state.doc)).toHaveLength(1);
  expect(state.doc.firstChild!.attrs.revisionBlock?.kind).toBe('insertion');
  expect(reviewedDocument(state.doc, 'original').eq(schema.node('doc', null, schema.node('paragraph')))).toBe(true);
});
