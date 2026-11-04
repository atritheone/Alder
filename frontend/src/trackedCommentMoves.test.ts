// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { DOMSerializer } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { history, undo, redo } from 'prosemirror-history';
import { schema } from './Editor';
import { blockIdentities, identifiedDocument } from './blockIdentities';
import { documentUnits, moveArrangementUnit } from './arrangementUnits';
import { moveOutlineSection } from './documentOutline';
import { trackReviewTransaction, reviewedDocument, resolveReviewChanges } from './trackedReview';
import { validateReviewMoves } from './trackedMoves';
import { addDocumentComment, changeDocumentComment, commentSummary, documentComments } from './documentComments';
import { clipboardSlice } from './pasteText';
import { addRowAfter, deleteRow, TableMap, CellSelection } from 'prosemirror-tables';

const stamp = { id: 'comment_move', author: 'Reviewer', date: '' };
const thread = { resolved: false, entries: [{ id: 'first', author: 'Reader', text: 'Check this passage.', date: '' }] };
const anchor = (edge: string) => schema.node('comment_anchor', { threadId: 'thread', edge, thread });
const p = (children: any[]) => schema.node('paragraph', null, children);
function fixture(container: string, backwards = false) {
  const first = p([anchor('start'), schema.text('First commented passage.')]);
  const last = p([schema.text('Last commented passage.'), anchor('end')]);
  const blocks = container === 'table' ? [schema.node('table', null, schema.node('table_row', null, [schema.node('table_cell', null, first), schema.node('table_cell', null, last)]))]
    : container === 'ordered_list' ? [schema.node('ordered_list', null, [schema.node('list_item', null, first), schema.node('list_item', null, last)])] : [first, last];
  const moved = [schema.node('heading', { blockId: 'first', level: 1 }, schema.text('First')), ...blocks];
  const other = [schema.node('heading', { blockId: 'second', level: 1 }, schema.text('Second')), p([schema.text('Unrelated passage.')])];
  const original = identifiedDocument(schema.node('doc', null, backwards ? [...other, ...moved] : [...moved, ...other]));
  const initial = EditorState.create({ doc: original, plugins: [history(), blockIdentities()] });
  const movement = moveOutlineSection(initial, 'first', 'second', !backwards)!;
  const state = initial.applyTransaction(trackReviewTransaction(initial, movement, stamp)).state;
  return { original, movement, state };
}

it.each(['paragraphs', 'ordered_list', 'table'])('moves a comment spanning %s as one thread with both review outcomes', container => {
  const { original, movement, state } = fixture(container);
  validateReviewMoves(state.doc);
  const items = documentComments(state.doc);
  expect(items).toHaveLength(1); expect(items[0]).toMatchObject({ incomplete: false, id: 'thread', thread });
  expect(items[0].anchors).toHaveLength(4);
  expect(commentSummary(state.doc.toJSON())).toEqual({ total: 1, open: 1, incomplete: 0 });
  expect(reviewedDocument(state.doc, 'original').eq(original)).toBe(true);
  expect(reviewedDocument(state.doc, 'final').eq(movement.doc)).toBe(true);
  const html = document.createElement('div'); html.append(DOMSerializer.fromSchema(schema).serializeFragment(state.doc.content));
  const copy = identifiedDocument(schema.node('doc', null, clipboardSlice(schema, '', html.innerHTML, 'source').content));
  validateReviewMoves(copy);
  expect(documentComments(copy)).toHaveLength(1);
  expect(documentComments(copy)[0].id).not.toBe('thread');
  for (const view of ['original', 'final'] as const) {
    const comments = documentComments(reviewedDocument(copy, view));
    expect(comments).toHaveLength(1); expect(comments[0].incomplete).toBe(false); expect(comments[0].thread).toEqual(thread);
  }
});

it.each([false, true])('replies, resolves and deletes on both sides, with independent undo (backwards=%s)', backwards => {
  let { state } = fixture('table', backwards);
  const before = state.doc;
  const updated = { resolved: true, entries: [...thread.entries, { id: 'reply', author: 'Editor', text: 'Confirmed.', date: '' }] };
  const dispatch = (tr: any) => { state = state.applyTransaction(tr).state; };
  expect(changeDocumentComment('thread', updated)(state, dispatch)).toBe(true);
  validateReviewMoves(state.doc);
  for (const decision of ['accept', 'reject'] as const) {
    const result = state.applyTransaction(resolveReviewChanges(state, new Set([stamp.id]), decision)).state.doc;
    expect(documentComments(result)).toHaveLength(1);
    expect(documentComments(result)[0]).toMatchObject({ incomplete: false, thread: updated });
  }
  expect(changeDocumentComment('thread', null)(state, dispatch)).toBe(true);
  validateReviewMoves(state.doc); expect(documentComments(state.doc)).toHaveLength(0);
  undo(state, dispatch); expect(documentComments(state.doc)[0].thread).toEqual(updated);
  undo(state, dispatch); expect(state.doc.eq(before)).toBe(true);
  redo(state, dispatch); expect(documentComments(state.doc)[0].thread).toEqual(updated);
});

it.each([false, true])('adds and reanchors a comment inside a pending moved section (backwards=%s)', backwards => {
  let { state } = fixture('ordered_list', backwards);
  const item = documentComments(state.doc)[0];
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, item.from + 2, item.to - 2)));
  const dispatch = (tr: any) => { state = state.applyTransaction(tr).state; };
  expect(addDocumentComment(thread)(state, dispatch)).toBe(true);
  validateReviewMoves(state.doc); expect(documentComments(state.doc)).toHaveLength(2);
  const added = documentComments(state.doc).find(c => c.id !== 'thread')!;
  expect(added.anchors).toHaveLength(4); expect(added.incomplete).toBe(false);
  expect(addDocumentComment(thread, 'thread')(state, dispatch)).toBe(true);
  validateReviewMoves(state.doc);
  for (const view of ['original', 'final'] as const) {
    const comments = documentComments(reviewedDocument(state.doc, view));
    expect(comments).toHaveLength(2); expect(comments.every(c => !c.incomplete)).toBe(true);
    expect(comments[0].context).toBe(comments[1].context);
  }
});

it('refuses moving only one anchor and refuses annotations crossing a move boundary', () => {
  const doc = identifiedDocument(schema.node('doc', null, [p([anchor('start'), schema.text('First.')]), p([schema.text('Last.'), anchor('end')]), p([schema.text('Other.')])]));
  const initial = EditorState.create({ doc });
  const movement = moveArrangementUnit(initial, documentUnits(doc).find(u => u.kind === 'paragraph')!, doc.content.size)!;
  expect(() => trackReviewTransaction(initial, movement.tr, stamp)).toThrow(/complete commented passage/);
  let { state } = fixture('paragraphs');
  const inside = documentComments(state.doc)[0].from;
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, inside)));
  expect(addDocumentComment(thread)(state)).toBe(false);
});

it.each([false, true])('retains a comment across changed table rows (grouped=%s)', grouped => {
  const row = (children: any[]) => schema.node('table_row', null, schema.node('table_cell', null, p(children)));
  const original = identifiedDocument(schema.node('doc', null, schema.node('table', null, [
    row([schema.text('Before')]), row([anchor('start'), schema.text('Changed'), ...(!grouped ? [anchor('end')] : [])]),
    ...(grouped ? [row([schema.text('Other'), anchor('end')])] : []), row([schema.text('After')]),
  ])));
  const map = TableMap.get(original.firstChild!);
  let state = EditorState.create({ doc: original, plugins: [history(), blockIdentities()],
    selection: CellSelection.rowSelection(original.resolve(1 + map.map[1]), original.resolve(1 + map.map[grouped ? 2 : 1])) });
  deleteRow(state, tr => { state = state.applyTransaction(trackReviewTransaction(state, tr, stamp)).state; });
  validateReviewMoves(state.doc);
  expect(documentComments(reviewedDocument(state.doc, 'original'))).toHaveLength(1);
  expect(documentComments(reviewedDocument(state.doc, 'final'))).toHaveLength(0);
  const item = documentComments(state.doc)[0];
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, item.from, item.to)));
  expect(addDocumentComment(thread)(state, tr => { state = state.applyTransaction(tr).state; })).toBe(true);
  validateReviewMoves(state.doc);
  const comments = documentComments(reviewedDocument(state.doc, 'original'));
  expect(comments).toHaveLength(2); expect(comments.every(c => !c.incomplete)).toBe(true);
});

it('can comment a pending inserted row and refuses deleting just one end of a range', () => {
  const row = (children: any[]) => schema.node('table_row', null, schema.node('table_cell', null, p(children)));
  const doc = identifiedDocument(schema.node('doc', null, schema.node('table', null, [row([anchor('start'), schema.text('First')]), row([schema.text('Last'), anchor('end')])])));
  let state = EditorState.create({ doc, selection: TextSelection.create(doc, 4), plugins: [blockIdentities()] });
  expect(() => deleteRow(state, tr => trackReviewTransaction(state, tr, stamp))).toThrow(/complete commented passage/);
  addRowAfter(state, tr => { state = state.applyTransaction(trackReviewTransaction(state, tr, stamp)).state; });
  let pos = 0; state.doc.descendants((n, p) => { if (n.type.name === 'table_row' && n.attrs.revisionBlock) pos = p + 3; });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
  expect(addDocumentComment(thread)(state, tr => { state = state.applyTransaction(tr).state; })).toBe(true);
  validateReviewMoves(state.doc);
  expect(documentComments(reviewedDocument(state.doc, 'final'))).toHaveLength(2);
  expect(documentComments(reviewedDocument(state.doc, 'original'))).toHaveLength(1);
});
