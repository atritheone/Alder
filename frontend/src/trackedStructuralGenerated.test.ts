// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { DOMSerializer } from 'prosemirror-model';
import { schema } from './Editor';
import { identifiedDocument, blockIdentities } from './blockIdentities';
import { moveOutlineSection } from './documentOutline';
import { trackReviewTransaction, reviewedDocument } from './trackedReview';
import { validateReviewMoves } from './trackedMoves';
import { clipboardSlice } from './pasteText';
import { numberedDocument } from './documentCaptions';
import { citationInput, applyCitationOutput } from './documentCitations';
import { processCitations } from './citationProcessor';
import { referenceIndex, refreshedReferences, referenceRefreshTransaction } from './documentReferences';
import { indexEntries } from './documentIndex';

it.each(['table', 'ordered_list'])('refreshes generated objects inside moved %s exactly once and retains copied targets', container => {
  const seq = (id: string, text: string) => schema.node('sequence', { blockId: id, sequenceName: 'Figure' }, schema.text(text), [schema.marks.strong.create()]);
  const cite = (id: string, text: string) => schema.node('citation', { blockId: id, renderedStyle: 'ieee', items: [{ source: { id, type: 'book', title: `Source ${id}`, author: [{ family: id }], issued: { 'date-parts': [[2020]] } }, locator: '12', label: 'page' }] }, schema.text(text));
  const paragraph = schema.node('paragraph', null, [schema.text('Moved: '), seq('one', '1'), cite('first', '[1, p. 12]'), schema.node('cross_reference', { blockId: 'ref', targetId: 'second' }, schema.text('Stale heading')), schema.node('index_entry', { blockId: 'entry', terms: ['Trees', 'Alder'], sortTerms: ['', 'Alnus'], indexGroup: 'P' })]);
  const block = container === 'table' ? schema.node('table', null, schema.node('table_row', null, schema.node('table_cell', null, paragraph))) : schema.node('ordered_list', { order: 3 }, schema.node('list_item', null, paragraph));
  const before = identifiedDocument(schema.node('doc', null, [schema.node('heading', { level: 1, blockId: 'first-heading' }, schema.text('First')), block, schema.node('heading', { level: 1, blockId: 'second' }, schema.text('Second')), schema.node('paragraph', null, [schema.text('Other: '), seq('two', '2'), cite('second-cite', '[2, p. 12]')])]));
  let state = EditorState.create({ doc: before, plugins: [blockIdentities()] });
  const move = moveOutlineSection(state, 'first-heading', 'second', true)!;
  state = state.applyTransaction(trackReviewTransaction(state, move, { id: 'generated-move', author: 'Reviewer', date: '' })).state;
  validateReviewMoves(state.doc);
  expect(reviewedDocument(state.doc, 'original').eq(before)).toBe(true);
  const input = citationInput([state.doc.toJSON()], 'ieee');
  expect(input.citations.map(c => c.id)).toEqual(['second-cite', 'first']);
  const output = processCitations(input);
  expect(output.bibliography).toHaveLength(2);
  let refreshed = numberedDocument(state.doc.toJSON(), { Figure: 0, Table: 0 });
  refreshed = applyCitationOutput(refreshed, output, 'ieee');
  refreshed = refreshedReferences(refreshed, referenceIndex([{ document: refreshed }]));
  state = state.applyTransaction(referenceRefreshTransaction(state, schema.nodeFromJSON(refreshed))!).state;
  validateReviewMoves(state.doc);
  const values = (kind: string) => { const result: string[] = [];state.doc.descendants(n => { if (n.type.name === kind) result.push(n.textContent); });return result; };
  expect(values('sequence')).toEqual(['2', '1', '2']);
  expect(values('citation')).toEqual(['[2, p. 12]', '[1, p. 12]', '[2, p. 12]']);
  expect(values('cross_reference')).toEqual(['Second', 'Second']);
  expect(indexEntries(state.doc).map(n => n.id)).toEqual(['entry']);
  const html = document.createElement('div');html.append(DOMSerializer.fromSchema(schema).serializeFragment(state.doc.content));
  const copied = identifiedDocument(schema.node('doc', null, clipboardSlice(schema, '', html.innerHTML, 'source').content));
  validateReviewMoves(copied);
  for (const doc of [state.doc, copied]) for (const view of ['original', 'final'] as const) {
    const reviewed = reviewedDocument(doc, view);
    expect(citationInput([reviewed.toJSON()], 'ieee').citations).toHaveLength(2);
    expect(indexEntries(reviewed)).toHaveLength(1);
    const targets = referenceIndex([{ document: reviewed.toJSON() }]);
    reviewed.descendants(n => { if (n.type.name === 'cross_reference') expect(targets.resolve(n.attrs.targetId)).toBe('Second'); });
  }
});
