import { Fragment, type NodeSpec } from 'prosemirror-model';
import { TextSelection, type Command, type EditorState } from 'prosemirror-state';
import { closeHistory } from 'prosemirror-history';
import { selectedList } from './listFormatting';
import { parseBlockMove } from './trackedBlockMoves';
import { parseBlockChange } from './trackedBlockChanges';

export function listItemMoveSpec(spec: NodeSpec): NodeSpec {
  return {...spec,attrs:{...spec.attrs,revisionMove:{default:null},revisionBlock:{default:null}},
    parseDOM:[{tag:'li',getAttrs:dom=>({revisionMove:parseBlockMove(dom.getAttribute('data-revision-block-move')),revisionBlock:parseBlockChange(dom.getAttribute('data-revision-block'))})}],
    toDOM:node=>['li',{'data-revision-block-move':node.attrs.revisionMove?JSON.stringify(node.attrs.revisionMove):null,'data-revision-move-kind':node.attrs.revisionMove?.kind||null,
      'data-revision-block':node.attrs.revisionBlock?JSON.stringify(node.attrs.revisionBlock):null,'data-revision-block-kind':node.attrs.revisionBlock?.kind||null},0]};
}

export function selectedItems(state:EditorState){
  const selected=selectedList(state);if(!selected)return null;
  const {node,depth,index,position}=selected,{$to}=state.selection;
  const end=$to.depth<depth||$to.pos>=position+node.nodeSize-1?node.childCount:$to.index(depth)-($to.depth===depth&&!state.selection.empty?1:0)+1;
  if(end<=index||end>node.childCount)return null;
  const items=Array.from({length:node.childCount},(_,i)=>node.child(i));
  const offset=(i:number)=>position+1+items.slice(0,i).reduce((total,item)=>total+item.nodeSize,0);
  return {...selected,items,end,offset,from:offset(index),to:offset(end)};
}

/** Move the complete selected items, including continuation paragraphs/sublists. */
export function moveListItems(direction: -1 | 1): Command {
  return (state,dispatch)=>{
    const selected=selectedItems(state);if(!selected)return false;
    const {node,index,end,items,offset,from,to}=selected;
    if(direction<0?index===0:end===node.childCount)return false;
    if(!dispatch)return true;
    const destination=offset(direction<0?index-1:end+1);
    const tr=closeHistory(state.tr).delete(from,to),at=tr.mapping.map(destination);
    tr.insert(at,Fragment.fromArray(items.slice(index,end)));
    tr.setSelection(TextSelection.between(tr.doc.resolve(at+state.selection.from-from),tr.doc.resolve(at+state.selection.to-from)));
    dispatch(tr.setMeta('arrangementMove',{kind:'item',from,to,destination}).scrollIntoView());return true;
  };
}
