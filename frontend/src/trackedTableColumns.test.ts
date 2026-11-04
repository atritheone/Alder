// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { addColumnAfter, deleteColumn, mergeCells, TableMap, CellSelection } from 'prosemirror-tables';
import { DOMSerializer } from 'prosemirror-model';
import { history, undo, redo } from 'prosemirror-history';
import { schema } from './Editor';
import { identifiedDocument, blockIdentities } from './blockIdentities';
import { trackReviewTransaction, reviewedDocument, resolveReviewChanges, reviewChanges } from './trackedReview';
import { validateReviewMoves } from './trackedMoves';
import { clipboardSlice } from './pasteText';
const stamp = { id: 'column-change', author: 'Reviewer', date: '' };
const p = (text: string) => schema.node('paragraph', null, text ? schema.text(text) : undefined);
const row = (text: string) => schema.node('table_row', null, ['Left', 'Middle', 'Right'].map(label => schema.node('table_cell', { colwidth: [120] }, p(text + ' ' + label))));
const initial = () => {
  const doc = identifiedDocument(schema.node('doc', null, [schema.node('table', null, [row('First'), row('Last')]), p('After')]));
  return EditorState.create({ doc, selection: TextSelection.create(doc, 1 + TableMap.get(doc.firstChild!).map[0] + 2), plugins: [history(), blockIdentities()] });
};
const shape = (doc: ReturnType<typeof initial>['doc']) => Array.from({ length: doc.firstChild!.childCount }, (_, r) =>
  Array.from({ length: doc.firstChild!.child(r).childCount }, (_, c) => ({ text: doc.firstChild!.child(r).child(c).textContent, width: doc.firstChild!.child(r).child(c).attrs.colwidth })));
it.each(['insert', 'delete'])('reviews a whole column, with history and clipboard (%s)', kind => {
  let state = initial(); const before = state.doc; let source: any;
  (kind === 'insert' ? addColumnAfter : deleteColumn)(state, tr => { source = tr; });
  state = state.applyTransaction(trackReviewTransaction(state, source, stamp)).state;
  validateReviewMoves(state.doc); expect(reviewChanges(state.doc)).toHaveLength(1);
  for (const view of ['original', 'final'] as const) {
    const actual = reviewedDocument(state.doc, view);
    expect(TableMap.get(actual.firstChild!).problems).toBeNull();
    expect(shape(actual)).toEqual(shape(view === 'original' ? before : source.doc));
  }
  for (const decision of ['accept', 'reject'] as const) {
    const actual = state.applyTransaction(resolveReviewChanges(state, new Set([stamp.id]), decision)).state.doc;
    expect(shape(actual)).toEqual(shape(decision === 'accept' ? source.doc : before));
  }
  const html = document.createElement('div'); html.append(DOMSerializer.fromSchema(schema).serializeFragment(state.doc.content));
  const copied = schema.node('doc', null, clipboardSlice(schema, '', html.innerHTML, 'source').content);
  validateReviewMoves(copied); expect(reviewChanges(copied)).toHaveLength(1);
  const pending = state.doc;
  undo(state, tr => { state = state.applyTransaction(tr).state; }); expect(state.doc.eq(before)).toBe(true);
  redo(state, tr => { state = state.applyTransaction(tr).state; }); expect(state.doc.eq(pending)).toBe(true);
});

it('keeps typing inside an inserted column in its insertion and allows cancelling it', () => {
  let state = initial(), source: any;
  const before = state.doc;
  addColumnAfter(state, tr => { source = tr; });
  state = state.applyTransaction(trackReviewTransaction(state, source, stamp)).state;
  const map = TableMap.get(state.doc.firstChild!);
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1 + map.map[1] + 2)));
  state = state.applyTransaction(trackReviewTransaction(state, state.tr.insertText('New words'), { ...stamp, id: 'typing' })).state;
  expect(reviewChanges(state.doc).map(c => c.id)).toEqual([stamp.id]);
  expect(state.doc.firstChild!.firstChild!.child(1).textContent).toBe('New words');
  deleteColumn(state, tr => { source = tr; });
  state = state.applyTransaction(trackReviewTransaction(state, source, { ...stamp, id: 'remove' })).state;
  expect(shape(state.doc)).toEqual(shape(before)); expect(reviewChanges(state.doc)).toEqual([]);
});

it('groups multiple selected columns into one complete review', () => {
  let state = initial(); const map = TableMap.get(state.doc.firstChild!);
  state = state.apply(state.tr.setSelection(CellSelection.colSelection(state.doc.resolve(1 + map.map[0]), state.doc.resolve(1 + map.map[4]))));
  let source: any; deleteColumn(state, tr => { source = tr; });
  state = state.applyTransaction(trackReviewTransaction(state, source, stamp)).state;
  expect(reviewChanges(state.doc)).toHaveLength(1);
  expect(TableMap.get(reviewedDocument(state.doc, 'final').firstChild!).width).toBe(1);
  expect(TableMap.get(reviewedDocument(state.doc, 'original').firstChild!).width).toBe(3);
});

it('rejects incomplete column groups before they can make an invalid review grid', () => {
  let state = initial(), source: any; addColumnAfter(state, tr => { source = tr; });
  state = state.applyTransaction(trackReviewTransaction(state, source, stamp)).state;
  const doc = state.doc.toJSON(), cell = doc.content[0].content[1].content[1];
  cell.attrs.revisionBlock = null;
  expect(() => validateReviewMoves(schema.nodeFromJSON(doc))).toThrow();
});

it('cancels one inserted column without losing the rest of a grouped insertion', () => {
  let state = initial(); const map = TableMap.get(state.doc.firstChild!);
  state = state.apply(state.tr.setSelection(CellSelection.colSelection(state.doc.resolve(1 + map.map[0]), state.doc.resolve(1 + map.map[4]))));
  let source: any; addColumnAfter(state, tr => { source = tr; });
  addColumnAfter(state.apply(source), tr => { for (const step of tr.steps) source.step(step); });
  state = state.applyTransaction(trackReviewTransaction(state, source, stamp)).state;
  const added = TableMap.get(state.doc.firstChild!);
  expect(added.width).toBe(5);
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1 + added.map[2] + 2)));
  deleteColumn(state, tr => { source = tr; });
  state = state.applyTransaction(trackReviewTransaction(state, source, { ...stamp, id: 'cancel-part' })).state;
  validateReviewMoves(state.doc);
  expect(reviewChanges(state.doc)).toHaveLength(1);
  expect(TableMap.get(reviewedDocument(state.doc, 'final').firstChild!).width).toBe(4);
  expect(shape(reviewedDocument(state.doc, 'original'))).toEqual(shape(initial().doc));
});

it('keeps deleted columns protected and refuses overlapping merged grids', () => {
  let state = initial(), source: any;
  deleteColumn(state, tr => { source = tr; });
  state = state.applyTransaction(trackReviewTransaction(state, source, stamp)).state;
  const cell = 1 + TableMap.get(state.doc.firstChild!).map[0];
  expect(() => trackReviewTransaction(state, state.tr.insertText('Changed', cell + 2), { ...stamp, id: 'typing' })).toThrow();
  state = initial(); const map = TableMap.get(state.doc.firstChild!);
  state = state.apply(state.tr.setSelection(new CellSelection(state.doc.resolve(1 + map.map[0]), state.doc.resolve(1 + map.map[1]))));
  mergeCells(state, tr => { state = state.apply(tr); });
  addColumnAfter(state, tr => { source = tr; });
  const before = state.doc;
  expect(() => trackReviewTransaction(state, source, stamp)).toThrow();
  expect(state.doc.eq(before)).toBe(true);
});
