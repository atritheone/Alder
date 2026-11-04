import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, Selection, type Transaction } from 'prosemirror-state';
import { closeHistory } from 'prosemirror-history';
import { TableMap } from 'prosemirror-tables';
import type { RevisionStamp } from './trackedChanges';
import { tableRowBoundary } from './tableStructure';

/** A row operation must leave every other node and the table's properties intact. */
export function changedTable(before: PMNode, after: PMNode, pos = -1): { before: PMNode; after: PMNode; pos: number } | null {
  if (before.eq(after) || !before.sameMarkup(after)) return null;
  const table = before.type.name === 'table' ? { before, after, pos } : null;
  if (before.childCount !== after.childCount) return table;
  let found: ReturnType<typeof changedTable> = null, offset = pos + 1;
  for (let i = 0; i < before.childCount; i++) {
    const a = before.child(i), b = after.child(i);
    if (!a.eq(b)) {
      if (found) return null;
      found = changedTable(a, b, offset);
      if (!found) return table;
    }
    offset += a.nodeSize;
  }
  return found || table;
}

function changedRows(before: PMNode, after: PMNode) {
  const pair = changedTable(before, after);
  if (!pair || pair.before.childCount === pair.after.childCount) return null;
  const insertion = pair.after.childCount > pair.before.childCount;
  const longer = insertion ? pair.after : pair.before, shorter = insertion ? pair.before : pair.after;
  const count=longer.childCount-shorter.childCount;
  let index = 0;
  while (index < shorter.childCount && shorter.child(index).eq(longer.child(index))) index++;
  for (let i = index; i < shorter.childCount; i++) if (!shorter.child(i).eq(longer.child(i + count))) return null;
  return {...pair,insertion,longer,index,count};
}

export function trackTableRowChange(state: EditorState, source: Transaction, stamp: RevisionStamp) {
  const change=changedRows(state.doc,source.doc);
  if(!change)return null;
  const {insertion,longer,index,count}=change;
  const map = TableMap.get(longer);
  if (map.problems?.length || !tableRowBoundary(map,index) || !tableRowBoundary(map,index+count))
    throw Error('Review connected merged rows together. The document has not changed.');
  const rows=Array.from({length:count},(_,i)=>longer.child(index+i));
  if(rows.some(row=>row.attrs.revisionBlock||row.attrs.revisionMove))return null;
  let position = change.pos + 1;
  for (let i = 0; i < index; i++) position += longer.child(i).nodeSize;
  const tr = insertion ? source : closeHistory(state.tr);
  for(let part=0;part<count;part++){
    const row=rows[part],identifier = row.attrs.blockId || `block_${crypto.randomUUID()}`;
    const attrs = { ...row.attrs, blockId: identifier, revisionBlock: { kind: insertion ? 'insertion' : 'deletion', stamp, originalId: identifier, ...(count>1?{count,part}:{}) } };
    tr.setNodeMarkup(position, undefined, attrs);
    position+=row.nodeSize;
  }
  if(!insertion)tr.setSelection(Selection.near(tr.doc.resolve(Math.min(position,tr.doc.content.size)),1));
  return closeHistory(tr).setMeta('trackedEdit', stamp.id).setMeta('structuralReview',true);
}

/** Text entered into a newly inserted row belongs to that same row insertion. */
export function editsInsertedRow(state: EditorState, source: Transaction) {
  let insertedGroup: string | null = null;
  let editedRows=0;
  const inside = (before: PMNode, after: PMNode): boolean => {
    if (before.eq(after)) return false;
    if (!before.sameMarkup(after)) return false;
    if (before.type.name==='table_row' && before.attrs.revisionBlock?.kind==='insertion') {
      const group=before.attrs.revisionBlock.stamp.id;
      if(insertedGroup!==null&&insertedGroup!==group)return false;
      insertedGroup=group;editedRows++;return true;
    }
    if (before.childCount!==after.childCount) return false;
    let changed=0;
    for(let i=0;i<before.childCount;i++){
      if(before.child(i).eq(after.child(i)))continue;
      if(!inside(before.child(i),after.child(i)))return false;
      changed++;
    }
    return changed>0;
  };
  if(inside(state.doc,source.doc))return editedRows>1?'structure' as const:'contents' as const;
  // Removing a row that has not been accepted cancels its insertion.
  const change=changedRows(state.doc,source.doc);
  if(!change || change.insertion)return false;
  const removed=Array.from({length:change.count},(_,i)=>change.before.child(change.index+i));
  if(removed.some(row=>row.attrs.revisionBlock?.kind!=='insertion'))return false;
  const ids=new Set(removed.map(row=>row.attrs.revisionBlock.stamp.id));
  const groups=new Map<string,{node:PMNode;pos:number}[]>();
  source.doc.descendants((node,pos)=>{
    const id=node.attrs.revisionBlock?.stamp.id;
    if(node.type.name==='table_row' && ids.has(id))groups.set(id,[...(groups.get(id)||[]),{node,pos}]);
  });
  for(const group of groups.values())group.forEach(({node,pos},part)=>source.setNodeMarkup(pos,undefined,{
    ...node.attrs,revisionBlock:{...node.attrs.revisionBlock,count:group.length,part},
  }));
  source.setMeta('structuralReview',true);
  return 'remove' as const;
}
