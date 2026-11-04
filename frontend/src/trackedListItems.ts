import type { Node as PMNode } from 'prosemirror-model';
import { Selection, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { closeHistory } from 'prosemirror-history';
import type { RevisionStamp } from './trackedChanges';
import { selectedItems } from './listItemMoves';

const list=(node:PMNode)=>['ordered_list','bullet_list'].includes(node.type.name);
function changedList(before:PMNode,after:PMNode,pos=-1):{before:PMNode;after:PMNode;pos:number}|null{
  if(before.eq(after)||!before.sameMarkup(after))return null;
  const owner=list(before)?{before,after,pos}:null;
  if(before.childCount!==after.childCount)return owner;
  let result:ReturnType<typeof changedList>=null,offset=pos+1;
  for(let i=0;i<before.childCount;i++){
    if(!before.child(i).eq(after.child(i))){if(result)return null;result=changedList(before.child(i),after.child(i),offset);if(!result)return owner;}
    offset+=before.child(i).nodeSize;
  }
  return result||owner;
}
function changedItems(before:PMNode,after:PMNode){
  const pair=changedList(before,after);if(!pair||pair.before.childCount===pair.after.childCount)return null;
  const insertion=pair.after.childCount>pair.before.childCount,longer=insertion?pair.after:pair.before,shorter=insertion?pair.before:pair.after;
  const count=longer.childCount-shorter.childCount;let index=0;
  while(index<shorter.childCount&&shorter.child(index).eq(longer.child(index)))index++;
  for(let i=index;i<shorter.childCount;i++)if(!shorter.child(i).eq(longer.child(i+count)))return null;
  let position=pair.pos+1;for(let i=0;i<index;i++)position+=longer.child(i).nodeSize;
  return {...pair,insertion,longer,index,count,position};
}
export function insertListItem(direction:-1|1):Command{
  return(state,dispatch)=>{
    const selected=selectedItems(state);if(!selected)return false;if(!dispatch)return true;
    const at=direction<0?selected.from:selected.to;
    const tr=closeHistory(state.tr).insert(at,state.schema.nodes.list_item.create(null,state.schema.nodes.paragraph.create()));
    dispatch(tr.setSelection(TextSelection.create(tr.doc,at+2)).scrollIntoView());return true;
  };
}
export const deleteListItems:Command=(state,dispatch)=>{
  const selected=selectedItems(state);if(!selected)return false;
  const whole=selected.end-selected.index===selected.node.childCount,from=selected.from-(whole?1:0),to=selected.to+(whole?1:0);
  if(dispatch){const tr=closeHistory(state.tr).delete(from,to);dispatch(tr.setSelection(Selection.near(tr.doc.resolve(Math.min(from,tr.doc.content.size)),1)).scrollIntoView());}
  return true;
};
export function trackListItemChange(state:EditorState,source:Transaction,stamp:RevisionStamp){
  const change=changedItems(state.doc,source.doc);if(!change)return null;
  const {insertion,longer,index,count}=change;
  const items=Array.from({length:count},(_,i)=>longer.child(index+i));
  if(items.some(item=>item.attrs.revisionBlock||item.attrs.revisionMove))return null;
  const tr=insertion?source:closeHistory(state.tr);let position=change.position;
  for(let part=0;part<count;part++){
    const item=items[part],identity=insertion?`block_${crypto.randomUUID()}`:item.attrs.blockId||`block_${crypto.randomUUID()}`;
    tr.setNodeMarkup(position,undefined,{...item.attrs,blockId:identity,revisionBlock:{kind:insertion?'insertion':'deletion',stamp,originalId:identity,...(count>1?{count,part}:{})}});
    position+=item.nodeSize;
  }
  if(!insertion)tr.setSelection(Selection.near(tr.doc.resolve(position),1));
  return closeHistory(tr).setMeta('trackedEdit',stamp.id).setMeta('structuralReview',true);
}
export function editsInsertedItem(state:EditorState,source:Transaction){
  let group:string|null=null;
  const inside=(before:PMNode,after:PMNode):boolean=>{
    if(before.eq(after)||!before.sameMarkup(after))return false;
    if(before.type.name==='list_item'&&before.attrs.revisionBlock?.kind==='insertion'){
      const id=before.attrs.revisionBlock.stamp.id;if(group!==null&&group!==id)return false;group=id;return true;
    }
    if(before.childCount!==after.childCount)return false;let changed=false;
    for(let i=0;i<before.childCount;i++){if(before.child(i).eq(after.child(i)))continue;if(!inside(before.child(i),after.child(i)))return false;changed=true;}
    return changed;
  };
  if(inside(state.doc,source.doc))return 'contents' as const;
  const change=changedItems(state.doc,source.doc);if(!change||change.insertion)return false;
  const removed=Array.from({length:change.count},(_,i)=>change.before.child(change.index+i));
  if(removed.some(item=>item.attrs.revisionBlock?.kind!=='insertion'))return false;
  const ids=new Set(removed.map(item=>item.attrs.revisionBlock.stamp.id)),groups=new Map<string,{node:PMNode;pos:number}[]>();
  source.doc.descendants((node,pos)=>{const id=node.attrs.revisionBlock?.stamp.id;if(node.type.name==='list_item'&&ids.has(id))groups.set(id,[...(groups.get(id)||[]),{node,pos}]);});
  for(const entries of groups.values())entries.forEach(({node,pos},part)=>source.setNodeMarkup(pos,undefined,{...node.attrs,revisionBlock:{...node.attrs.revisionBlock,count:entries.length,part}}));
  source.setMeta('structuralReview',true);return 'remove' as const;
}
