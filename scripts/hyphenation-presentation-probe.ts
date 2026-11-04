// Browser geometry fixture only; never bundled into Alder.
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from '../frontend/src/Editor';
import { discretionaryHyphens, expandHyphenation, settleHyphenation, hyphenationStatus } from '../frontend/src/hyphenation';
const host = document.body.appendChild(document.createElement('div'));
host.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#ddd;padding:50px;overflow:auto';
const sleep = () => new Promise(resolve => setTimeout(resolve, 20));
(window as any).__hyphenPresentation = async ({ font, width, align }: { font: string; width: number; align: string }) => {
  host.replaceChildren();
  const text = 'extraordinary representation internationalisation characteristically office efficient affinity different fictional paragraph '.repeat(5);
  const p = () => schema.node('paragraph', { hyphenation: true }, schema.text(text));
  const plugin = discretionaryHyphens(() => ({ styles: [], language: 'en-GB', enabled: true }), v => v.updateState(v.state), message => { throw Error(message); });
  const view = new EditorView(host, { state: EditorState.create({ doc: schema.node('doc', null, [p(), p()]), plugins: [plugin] }) });
  view.dom.style.cssText = `width:${width}px;font:16pt '${font}';line-height:1.5;text-align:${align}`;
  const ready = async () => {
    for (let i = 0; i < 500 && hyphenationStatus(view).pending; i++) await sleep();
    if (hyphenationStatus(view).pending || hyphenationStatus(view).error) throw Error('Hyphenation did not finish');
    await document.fonts.ready;
  };
  const geometry = () => {
    const result: number[][] = [], base = view.dom.getBoundingClientRect();
    const walker = document.createTreeWalker(view.dom, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest('.ProseMirror-widget')) continue;
      const range = document.createRange();
      for (let offset = 0; offset < node.textContent!.length; offset++) {
        range.setStart(node, offset); range.setEnd(node, offset + 1);
        const box = range.getBoundingClientRect();
        result.push([box.left - base.left, box.top - base.top, box.width, box.height].map(value => Math.round(value * 64) / 64));
      }
    }
    return result;
  };
  const same = (a: number[][], b: number[][]) => a.length === b.length && a.every((box,index) => box.every((value,axis) => Math.abs(value-b[index][axis]) <= (axis % 2 === 0 ? 0.1 : 0.01)));
  try {
    await ready();
    const before = geometry(), count = () => view.dom.querySelectorAll('.discretionary-hyphen').length;
    const total = count(); settleHyphenation(view); const retained = count(), after = geometry();
    view.dispatch(view.state.tr.insertText('different ', 32)); await ready();
    const editBefore = geometry(); settleHyphenation(view); const editAfter = geometry();
    view.dom.style.width = `${width + 37}px`; expandHyphenation(view); await ready();
    const resizedBefore = geometry(); settleHyphenation(view); const resizedAfter = geometry();
    return { total, retained, unchanged: same(before, after),
      editUnchanged: same(editBefore, editAfter), resizedUnchanged: same(resizedBefore, resizedAfter),
      maxShift: Math.max(...before.map((item,index)=>Math.abs(item[0]-after[index][0]))),
      changedLines: before.filter((item,index)=>item[1]!==after[index][1]).length,
    };
  } finally { view.destroy(); }
};
