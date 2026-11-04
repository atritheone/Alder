import type { Node as PMNode } from 'prosemirror-model';
import { Selection, type EditorState, type Transaction } from 'prosemirror-state';
import { ReplaceStep } from 'prosemirror-transform';
import { closeHistory } from 'prosemirror-history';
import type { RevisionStamp } from './trackedChanges';

const list = (node: PMNode | null | undefined) => !!node && ['ordered_list', 'bullet_list'].includes(node.type.name);
function removedList(state: EditorState, tr: Transaction) {
  if (tr.steps.length !== 1 || !(tr.steps[0] instanceof ReplaceStep)) return null;
  const step = tr.steps[0], node = state.doc.nodeAt(step.from);
  if (!list(node) || step.to !== step.from + node!.nodeSize || step.slice.openStart || step.slice.openEnd) return null;
  const at = state.doc.resolve(step.from), empty = step.slice.content.firstChild;
  if (step.slice.size && !(at.parent.childCount === 1 && step.slice.content.childCount === 1 && empty?.type.name === 'paragraph' && !empty.content.size)) return null;
  return { node: node!, pos: step.from };
}

export function editsInsertedList(state: EditorState, tr: Transaction) {
  if (removedList(state, tr)?.node.attrs.revisionBlock?.kind === 'insertion') return true;
  let found = false;
  const inside = (before: PMNode, after: PMNode): boolean => {
    if (before.eq(after)) return true;
    if (list(before) && list(after) && before.attrs.revisionBlock?.kind === 'insertion') {
      if (found || before.attrs.blockId !== after.attrs.blockId || JSON.stringify(before.attrs.revisionBlock) !== JSON.stringify(after.attrs.revisionBlock)) return false;
      found = true; return true;
    }
    if (!before.sameMarkup(after) || before.childCount !== after.childCount) return false;
    for (let i = 0; i < before.childCount; i++) if (!inside(before.child(i), after.child(i))) return false;
    return true;
  };
  return inside(state.doc, tr.doc) && found;
}

export function trackListChange(state: EditorState, source: Transaction, stamp: RevisionStamp) {
  const removed = removedList(state, source); let node = removed?.node, pos = removed?.pos;
  if (!removed) {
    if (source.steps.length !== 1 || !(source.steps[0] instanceof ReplaceStep)) return null;
    const step = source.steps[0];
    if (step.slice.openStart || step.slice.openEnd || step.slice.content.childCount !== 1 || !list(step.slice.content.firstChild)) return null;
    if (step.from !== step.to) {
      const at = state.doc.resolve(step.from), placeholder = at.nodeAfter, empty = state.schema.nodes.paragraph.create();
      if (at.parent.childCount !== 1 || !['doc','table_cell','table_header'].includes(at.parent.type.name) ||
          placeholder?.type !== empty.type || placeholder.content.size || step.to !== step.from + placeholder.nodeSize ||
          Object.keys(empty.attrs).some(key => key !== 'blockId' && JSON.stringify(empty.attrs[key]) !== JSON.stringify(placeholder.attrs[key]))) return null;
    }
    node = step.slice.content.firstChild!; pos = step.from;
  }
  if (!node || pos === undefined || node.attrs.revisionMove || node.attrs.revisionBlock) return null;
  const identity = node.attrs.blockId || `block_${crypto.randomUUID()}`, tr = closeHistory(removed ? state.tr : source);
  tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: identity, revisionBlock: { kind: removed ? 'deletion' : 'insertion', stamp, originalId: identity } });
  if (removed) tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos + node.nodeSize, tr.doc.content.size))));
  return tr.setMeta('trackedEdit', stamp.id).setMeta('structuralReview', true);
}
