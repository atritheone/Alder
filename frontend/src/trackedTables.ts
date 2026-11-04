import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, Selection, type Transaction } from 'prosemirror-state';
import { closeHistory } from 'prosemirror-history';
import { canJoin, ReplaceStep } from 'prosemirror-transform';
import type { RevisionStamp } from './trackedChanges';

const shapes=new WeakMap<PMNode,string>();
function shape(node: PMNode): string {
  const cached=shapes.get(node);if(cached!==undefined)return cached;
  if(node.isTextblock)return node.type.name;
  const children:string[]=[];node.forEach(child=>children.push(shape(child)));
  const result=`${node.type.name}:${node.attrs.colspan || 1}:${node.attrs.rowspan || 1}[${children.join(',')}]`;
  shapes.set(node,result);return result;
}

function tableRemoval(state: EditorState, source: Transaction) {
  if (source.steps.length !== 1 || !(source.steps[0] instanceof ReplaceStep)) return null;
  const step = source.steps[0], node = state.doc.nodeAt(step.from);
  if (node?.type.name !== 'table' || step.to !== step.from + node.nodeSize || step.slice.openStart || step.slice.openEnd) return null;
  const empty = step.slice.content.firstChild;
  if (step.slice.size && !(step.from === 0 && step.to === state.doc.content.size && step.slice.content.childCount === 1 && empty?.type.name === 'paragraph' && !empty.content.size)) return null;
  return { node, pos: step.from };
}

export function editInsertedTable(state: EditorState, source: Transaction) {
  const removed = tableRemoval(state, source);
  if (removed?.node.attrs.revisionBlock?.kind === 'insertion') return 'remove';
  let found = false;
  let structure = false;
  const inside = (before: PMNode, after: PMNode): boolean => {
    if (before.eq(after)) return true;
    if (before.type.name === 'table' && after.type === before.type && before.attrs.revisionBlock?.kind === 'insertion') {
      if (found || before.attrs.blockId !== after.attrs.blockId || JSON.stringify(before.attrs.revisionBlock) !== JSON.stringify(after.attrs.revisionBlock)) return false;
      found = true; structure = !before.sameMarkup(after) || shape(before)!==shape(after); return true;
    }
    if (!before.sameMarkup(after) || before.childCount !== after.childCount) return false;
    for (let i = 0; i < before.childCount; i++) if (!inside(before.child(i), after.child(i))) return false;
    return true;
  };
  return inside(state.doc, source.doc) && found ? structure?'structure':'contents' : null;
}

/** Cancelling an inserted table also closes the split that introduced it. Text
 * deletion records belonging to a replacement remain independently reviewable. */
export function cancelInsertedTableBoundary(state: EditorState, tr: Transaction) {
  const removed=tableRemoval(state,tr);
  if (!removed) return;
  const at=state.doc.resolve(removed.pos), left=at.nodeBefore;
  const marker=left?.lastChild, right=state.doc.nodeAt(removed.pos+removed.node.nodeSize);
  if(marker?.type.name!=='revision_break' || marker.attrs.kind!=='insertion' ||
    marker.attrs.stamp.id!==removed.node.attrs.revisionBlock?.stamp.id ||
    marker.attrs.nextId!==right?.attrs.blockId || !canJoin(tr.doc,removed.pos)) return;
  tr.delete(removed.pos-2,removed.pos-1).join(removed.pos-1);
}

/** Complete tables carry one revision; their editable insertion owns its rows. */
export function trackTableChange(state: EditorState, source: Transaction, stamp: RevisionStamp) {
  const removed = tableRemoval(state, source);
  let table = removed?.node, pos = removed?.pos;
  if (!removed) {
    if (source.steps.length !== 1 || !(source.steps[0] instanceof ReplaceStep)) return null;
    const step = source.steps[0];
    if (step.from !== step.to || step.slice.openStart || step.slice.openEnd || step.slice.content.childCount !== 1 || step.slice.content.firstChild?.type.name !== 'table') return null;
    table = step.slice.content.firstChild; pos = step.from;
  }
  if (!table || pos === undefined || table.attrs.revisionMove || table.attrs.revisionBlock) return null;
  const id = table.attrs.blockId || `block_${crypto.randomUUID()}`;
  const tr = removed ? closeHistory(state.tr) : closeHistory(source);
  tr.setNodeMarkup(pos, undefined, { ...table.attrs, blockId: id,
    revisionBlock: { kind: removed ? 'deletion' : 'insertion', stamp, originalId: id } });
  if (removed) tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos + table.nodeSize, tr.doc.content.size))));
  return tr.setMeta('trackedEdit', stamp.id).setMeta('structuralReview', true);
}
