import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { type EditorState, type Transaction } from 'prosemirror-state';
import { ReplaceStep } from 'prosemirror-transform';
import { closeHistory } from 'prosemirror-history';
import type { RevisionStamp, ReviewView } from './trackedChanges';

/** Enter inside an authored item inserts a paragraph and item boundary. The
 * wording on either side remains independently editable and reviewable. */
export function trackItemSplit(state: EditorState, tr: Transaction, stamp: RevisionStamp) {
  if (tr.steps.length !== 1 || !(tr.steps[0] instanceof ReplaceStep)) return null;
  const step = tr.steps[0], start = state.doc.resolve(step.from);
  if (step.from !== step.to || step.slice.openStart !== 2 || step.slice.openEnd !== 2 ||
      step.slice.size !== 4 || start.depth < 2 || start.parent.type.name !== 'paragraph' || start.node(-1).type.name !== 'list_item') return null;
  let pending = false;
  start.parent.forEach(node => { if (node.type.name === 'revision_break' && node.attrs.kind === 'insertion') pending = true; });
  if (pending) throw Error("Review this paragraph's pending break before splitting it again. The document has not changed.");
  const right = tr.doc.resolve(step.from + 4);
  if (right.parent.type.name !== 'paragraph' || right.node(-1).type.name !== 'list_item' || right.depth !== start.depth) return null;
  const selection = tr.selection, nextId = `block_${crypto.randomUUID()}`;
  tr.setNodeMarkup(right.before(-1), undefined, { ...right.node(-1).attrs, blockId: `block_${crypto.randomUUID()}` });
  tr.setNodeMarkup(right.before(), undefined, { ...right.parent.attrs, blockId: nextId });
  tr.insert(step.from, state.schema.nodes.revision_break.create({ kind: 'insertion', scope: 'item', stamp, nextId, blockId: `block_${crypto.randomUUID()}` }));
  tr.setSelection(selection.map(tr.doc, tr.mapping.slice(1)));
  return closeHistory(tr).setMeta('trackedEdit', stamp.id).setMeta('structuralReview', true);
}

/** Backspace at an item's start joins the item containers, retaining the two
 * paragraphs. Keep the removed item's attributes at its first paragraph. */
export function trackItemJoin(state: EditorState, tr: Transaction, stamp: RevisionStamp) {
  if (tr.steps.length !== 1 || !(tr.steps[0] instanceof ReplaceStep)) return null;
  const step = tr.steps[0], left = state.doc.resolve(step.from), right = state.doc.resolve(step.to);
  if (step.slice.size || step.to - step.from !== 2 || left.parent.type.name !== 'list_item' ||
      right.parent.type.name !== 'list_item' || left.depth !== right.depth || left.node(-1) !== right.node(-1) ||
      left.parentOffset !== left.parent.content.size || right.parentOffset !== 0 || right.parent.firstChild?.type.name !== 'paragraph') return null;
  let pending = false;
  for (const item of [left.parent, right.parent]) item.descendants(node => {
    if (node.type.name === 'revision_break' || node.attrs.revisionBlock || node.attrs.revisionMove) pending = true;
  });
  if (pending || left.parent.attrs.revisionBlock || right.parent.attrs.revisionBlock)
    throw Error('Review the pending item boundaries before joining these items. The document has not changed.');
  const selection = tr.selection;
  tr.insert(step.from + 1, state.schema.nodes.revision_break.create({ kind: 'deletion', scope: 'item', stamp,
    nextId: right.parent.firstChild.attrs.blockId, rightType: 'list_item', rightAttrs: right.parent.attrs, blockId: `block_${crypto.randomUUID()}` }));
  tr.setSelection(selection.map(tr.doc, tr.mapping.slice(1)));
  return closeHistory(tr).setMeta('trackedEdit', stamp.id).setMeta('structuralReview', true);
}

function restoreItemJoins(doc: PMNode) {
  const boundaries = new WeakMap<PMNode, PMNode>();
  const walk = (node: PMNode): PMNode[] => {
    if (node.isLeaf) return [node];
    const children: PMNode[] = []; let boundary: PMNode | undefined;
    node.forEach(child => {
      if (child.type.name === 'revision_break' && child.attrs.scope === 'item' && child.attrs.kind === 'deletion') {
        if (boundary || node.type.name !== 'paragraph' || child.attrs.nextId !== node.attrs.blockId) throw Error('A deleted item boundary has moved apart.');
        boundary = child;
      } else children.push(...walk(child));
    });
    if (node.type.name === 'list_item') {
      const items: PMNode[] = []; let group: PMNode[] = [], attrs = node.attrs;
      for (const child of children) {
        const split = boundaries.get(child);
        if (split) {
          if (!group.length) throw Error('A deleted item boundary is missing its preceding item.');
          items.push(node.type.create(attrs, group)); group = []; attrs = split.attrs.rightAttrs;
        }
        group.push(child);
      }
      items.push(node.type.create(attrs, group)); return items;
    }
    if (children.some(child => boundaries.has(child))) throw Error('A deleted item boundary is outside its item.');
    const result = node.copy(Fragment.fromArray(children));
    if (boundary) boundaries.set(result, boundary);
    return [result];
  };
  return walk(doc)[0];
}

/** Resolve the item layer before the existing paragraph projection. This also
 * works inside nested lists and cells without flattening their containers. */
export function itemBreakView(doc: PMNode, view: ReviewView): PMNode {
  if (view === 'markup') return doc;
  if (view === 'original') doc = restoreItemJoins(doc);
  const joins = new WeakMap<PMNode, string>();
  const walk = (node: PMNode): PMNode => {
    if (node.isLeaf) return node;
    const children: PMNode[] = [];
    node.forEach(child => {
      if (child.type.name === 'revision_break' && child.attrs.scope === 'item') return;
      children.push(walk(child));
    });
    let result = node.copy(Fragment.fromArray(children));
    if (node.isTextblock && view === 'original') {
      node.forEach(child => {
        if (child.type.name === 'revision_break' && child.attrs.scope === 'item') {
          if (joins.has(result)) throw Error('An item has overlapping pending boundaries.');
          joins.set(result, child.attrs.nextId);
        }
      });
    }
    if (node.type.name === 'list_item' && view === 'original') {
      for (const child of children.slice(0, -1)) if (joins.has(child)) throw Error('An original-view item boundary has moved apart.');
      const last = children.at(-1), next = last && joins.get(last);
      if (next) joins.set(result, next);
    }
    if (['ordered_list', 'bullet_list'].includes(node.type.name) && view === 'original') {
      const combined: PMNode[] = [];
      for (const child of children) {
        const previous = combined.at(-1), nextId = previous && joins.get(previous);
        if (!nextId) { combined.push(child); continue; }
        if (child.firstChild?.attrs.blockId !== nextId || previous!.lastChild?.type.name !== 'paragraph' || child.firstChild.type.name !== 'paragraph')
          throw Error('An original-view item boundary has moved apart.');
        const left: PMNode[] = [], right: PMNode[] = [];
        previous!.forEach(n => left.push(n)); child.forEach(n => right.push(n));
        left[left.length - 1] = left.at(-1)!.copy(left.at(-1)!.content.append(right.shift()!.content));
        result = previous!.copy(Fragment.fromArray([...left, ...right]));
        combined[combined.length - 1] = result;
        const following = joins.get(child); if (following) joins.set(result, following);
      }
      if (combined.length && joins.has(combined.at(-1)!)) throw Error('An original-view item boundary is incomplete.');
      result = node.copy(Fragment.fromArray(combined));
    } else if (view === 'original' && node.type.name !== 'list_item' && children.some(child => joins.has(child))) {
      throw Error('An original-view item boundary is outside its list.');
    }
    return result;
  };
  return walk(doc);
}
