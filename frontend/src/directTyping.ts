import { Plugin, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

/** Avoid Chromium reparsing a large contentEditable tree for ordinary keys.
 * Composition, dead keys, replacement/dictation and unsupported target ranges
 * remain native. The original text-input hooks and transaction guards still run. */
export function directTyping() {
  let pending: { key: string; doc: EditorView['state']['doc']; selection: TextSelection } | null = null;
  return new Plugin({props:{handleDOMEvents:{
    keydown(view,event) {
      pending = view.editable && event.isTrusted && !event.defaultPrevented &&
        !view.composing && !event.isComposing && event.keyCode!==229 &&
        !event.ctrlKey && !event.metaKey && !event.altKey && /^[\x20-\x7e]$/.test(event.key) &&
        view.state.selection instanceof TextSelection && view.state.selection.$from.sameParent(view.state.selection.$to)
        ? {key:event.key,doc:view.state.doc,selection:view.state.selection} : null;
      return false;
    },
    keyup(){pending=null;return false;},
    blur(){pending=null;return false;},
    compositionstart(){pending=null;return false;},
    beforeinput(view,event) {
      const key=pending;pending=null;
      if(!key || !view.editable || !event.isTrusted || event.defaultPrevented || !event.cancelable ||
        view.composing || event.isComposing || event.inputType!=='insertText' || event.data!==key.key ||
        view.state.doc!==key.doc || !view.state.selection.eq(key.selection)) return false;
      const ranges=event.getTargetRanges?.();
      if(ranges?.length!==1)return false;
      const range=ranges[0];
      if(!view.dom.contains(range.startContainer)||!view.dom.contains(range.endContainer))return false;
      let from:number,to:number;
      try{from=view.posAtDOM(range.startContainer,range.startOffset);to=view.posAtDOM(range.endContainer,range.endOffset);}
      catch{return false;}
      if(from!==key.selection.from || to!==key.selection.to)return false;
      const text=event.data;
      const transaction=()=>view.state.tr.insertText(text,from,to).scrollIntoView();
      event.preventDefault();
      if(!view.someProp('handleTextInput',handle=>handle(view,from,to,text,transaction)))view.dispatch(transaction());
      return true;
    },
  }}});
}
