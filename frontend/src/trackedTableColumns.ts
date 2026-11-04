import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { EditorState, Selection, type Transaction } from 'prosemirror-state';
import { closeHistory } from 'prosemirror-history';
import { TableMap } from 'prosemirror-tables';
import type { RevisionStamp } from './trackedChanges';
import { changedTable } from './trackedTableRows';

export const isTableCell = (node: PMNode) => ['table_cell', 'table_header'].includes(node.type.name);
const cells = (table: PMNode) => {
  const result: { node: PMNode; pos: number; row: number; column: number }[] = [];
  table.forEach((row, offset, r) => row.forEach((node, at, column) => result.push({ node, pos: offset + at + 2, row: r, column })));
  return result;
};
const unmerged = (table: PMNode) => !TableMap.get(table).problems?.length && cells(table).every(({ node }) => node.attrs.colspan === 1 && node.attrs.rowspan === 1);

function changedColumns(before: PMNode, after: PMNode) {
  const pair = changedTable(before, after);
  if (!pair || pair.before.childCount !== pair.after.childCount) return null;
  const left = TableMap.get(pair.before), right = TableMap.get(pair.after);
  if (left.width === right.width) return null;
  if (!unmerged(pair.before) || !unmerged(pair.after))
    throw Error('Review column changes in an unmerged table. The document has not changed.');
  const insertion = right.width > left.width, longer = insertion ? pair.after : pair.before, shorter = insertion ? pair.before : pair.after;
  const count = Math.abs(left.width - right.width), width = Math.min(left.width, right.width);
  for (let row = 0; row < longer.childCount; row++) if (!longer.child(row).sameMarkup(shorter.child(row))) return null;
  const equal = (a: number, b: number) => Array.from({ length: longer.childCount }, (_, row) => longer.child(row).child(a).eq(shorter.child(row).child(b))).every(Boolean);
  let index = 0;
  while (index < width && equal(index, index)) index++;
  for (let column = index; column < width; column++) if (!equal(column + count, column)) return null;
  return { ...pair, insertion, longer, index, count };
}

/** A column boundary is one decision across every row, with a surviving column. */
export function validateTableColumnChanges(doc: PMNode | Fragment) {
  const owners = new Map<string, PMNode>();
  doc.descendants(table => {
    if (table.type.name !== 'table') return;
    const all = cells(table), changed = all.filter(({ node }) => node.attrs.revisionBlock || node.attrs.revisionMove);
    if (!changed.length) return;
    if (!unmerged(table) || table.attrs.revisionBlock || table.attrs.revisionMove || table.attrs.revisionProperties ||
        Array.from({ length: table.childCount }, (_, i) => table.child(i)).some(row => row.attrs.revisionBlock || row.attrs.revisionMove || row.attrs.revisionProperties))
      throw Error('Tracked column changes require an unchanged, unmerged surrounding table.');
    const groups = new Map<string, typeof changed>();
    for (const entry of changed) {
      if (entry.node.attrs.revisionMove) throw Error('Individual table cells cannot carry a tracked move.');
      const id = entry.node.attrs.revisionBlock.stamp.id;
      if (owners.has(id) && owners.get(id) !== table) throw Error('A tracked column change must stay within one table.');
      owners.set(id, table);
      const group = groups.get(id) || []; group.push(entry); groups.set(id, group);
    }
    for (const group of groups.values()) {
      const columns = group.filter(entry => entry.row === 0).map(entry => entry.column);
      if (!columns.length || columns.length === table.firstChild!.childCount || columns.some((col, i) => i > 0 && col !== columns[i - 1] + 1) ||
          group.length !== columns.length * table.childCount || group.some((entry, i) => entry.row !== Math.floor(i / columns.length) || entry.column !== columns[i % columns.length]))
        throw Error('Review complete consecutive columns across every row, leaving an unchanged column.');
    }
    if (all.every(({ node }) => node.attrs.revisionBlock)) throw Error('A reviewed table must retain an unchanged column.');
  });
}

export function trackTableColumnChange(state: EditorState, source: Transaction, stamp: RevisionStamp) {
  const change = changedColumns(state.doc, source.doc);
  if (!change) return null;
  const selected = cells(change.longer).filter(entry => entry.column >= change.index && entry.column < change.index + change.count);
  if (selected.some(({ node }) => node.attrs.revisionBlock || node.attrs.revisionMove)) return null;
  const tr = change.insertion ? source : state.tr;
  selected.forEach(({ node, pos }, part) => {
    const id = node.attrs.blockId || `block_${crypto.randomUUID()}`;
    tr.setNodeMarkup(change.pos + pos, undefined, { ...node.attrs, blockId: id,
      revisionBlock: { kind: change.insertion ? 'insertion' : 'deletion', stamp, originalId: id, part, count: selected.length } });
  });
  if (!change.insertion) tr.setSelection(Selection.near(tr.doc.resolve(change.pos + selected[0].pos + 2)));
  return closeHistory(tr).setMeta('trackedEdit', stamp.id).setMeta('structuralReview', true);
}

export function editsInsertedColumn(state: EditorState, source: Transaction) {
  let group: string | null = null, edited = false, structural = false;
  const shape = (node: PMNode): string => node.isTextblock ? node.type.name : `${node.type.name}[${Array.from({ length: node.childCount }, (_, i) => shape(node.child(i))).join(',')}]`;
  const inside = (before: PMNode, after: PMNode): boolean => {
    if (before.eq(after)) return true;
    if (isTableCell(before) && isTableCell(after) && before.attrs.revisionBlock?.kind === 'insertion') {
      const id = before.attrs.revisionBlock.stamp.id;
      if (group !== null && group !== id || before.attrs.blockId !== after.attrs.blockId || JSON.stringify(before.attrs.revisionBlock) !== JSON.stringify(after.attrs.revisionBlock)) return false;
      group = id; edited = true; structural ||= !before.sameMarkup(after) || shape(before) !== shape(after);
      return true;
    }
    if (!before.sameMarkup(after) || before.childCount !== after.childCount) return false;
    return Array.from({ length: before.childCount }, (_, i) => inside(before.child(i), after.child(i))).every(Boolean);
  };
  if (inside(state.doc, source.doc) && edited) return structural ? 'structure' : 'contents';
  const change = changedColumns(state.doc, source.doc);
  if (!change || change.insertion) return null;
  const removed = cells(change.before).filter(entry => entry.column >= change.index && entry.column < change.index + change.count);
  if (removed.some(({ node }) => node.attrs.revisionBlock?.kind !== 'insertion')) return null;
  const ids = new Set(removed.map(({ node }) => node.attrs.revisionBlock.stamp.id)), groups = new Map<string, { node: PMNode; pos: number }[]>();
  source.doc.descendants((node, pos) => {
    const id = node.attrs.revisionBlock?.stamp.id;
    if (isTableCell(node) && ids.has(id)) groups.set(id, [...(groups.get(id) || []), { node, pos }]);
  });
  for (const entries of groups.values()) entries.forEach(({ node, pos }, part) => source.setNodeMarkup(pos, undefined,
    { ...node.attrs, revisionBlock: { ...node.attrs.revisionBlock, part, count: entries.length } }));
  return 'remove';
}
