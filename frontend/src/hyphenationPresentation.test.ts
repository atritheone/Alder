// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from './Editor';
import { discretionaryHyphens, expandHyphenation, settleHyphenation, hasDiscretionaryBreak, hyphenationStatus } from './hyphenation';
vi.mock('./api', async original => ({ ...(await original<typeof import('./api')>()),
  api: async (_path: string, _method: string, body: { words: string[] }) => ({ breaks: body.words.map(() => [2, 4]) }),
}));
const views: EditorView[] = [];
afterEach(() => { views.splice(0).forEach(view => view.destroy()); document.body.replaceChildren(); vi.restoreAllMocks(); });
const paragraph = (text: string) => schema.node('paragraph', { hyphenation: true }, schema.text(text));
async function fixture() {
  const plugin = discretionaryHyphens(() => ({ styles: [], language: 'en', enabled: true }), v => v.updateState(v.state), () => {});
  const view = new EditorView(document.body.appendChild(document.createElement('div')), {
    state: EditorState.create({ doc: schema.node('doc', null, [paragraph('paragraph measured'), paragraph('paragraph measured')]), plugins: [plugin] }),
  });
  views.push(view);
  // The first layout can precede the asynchronous dictionary reply.
  settleHyphenation(view);
  await vi.waitFor(() => expect(hyphenationStatus(view).pending).toBe(false));
  return view;
}
const markers = (view: EditorView) => [...view.dom.querySelectorAll<HTMLElement>('.discretionary-hyphen')];

it('retains used breaks, removes invisible opportunities after dictionary loading and restores them for reflow', async () => {
  const view = await fixture(), doc = view.state.doc, original = markers(view);
  expect(original).toHaveLength(8);
  const positions = original.map(marker => view.posAtDOM(marker, 0));
  vi.spyOn(original[0], 'getBoundingClientRect').mockReturnValue({ width: 3 } as DOMRect);
  settleHyphenation(view);
  expect(markers(view)).toHaveLength(1);
  expect(view.state.doc).toBe(doc);
  positions.forEach(pos => expect(hasDiscretionaryBreak(doc, pos)).toBe(true));
  expandHyphenation(view);
  expect(markers(view)).toHaveLength(8);
  expect(view.state.doc).toBe(doc);
});

it('restores opportunities only in the edited paragraph and all of them when an intrinsic-width container is introduced', async () => {
  const view = await fixture(); settleHyphenation(view);
  expect(markers(view)).toHaveLength(0);
  view.dispatch(view.state.tr.insertText('x', 2));
  await vi.waitFor(() => expect(hyphenationStatus(view).pending).toBe(false));
  expect(markers(view)).toHaveLength(4);
  expect(view.dom.lastChild!.textContent).toBe('paragraph measured');
  settleHyphenation(view); expect(markers(view)).toHaveLength(0);
  const list = schema.node('bullet_list', null, schema.node('list_item', null, paragraph('paragraph measured')));
  view.dispatch(view.state.tr.insert(view.state.doc.content.size, list));
  await vi.waitFor(() => expect(hyphenationStatus(view).pending).toBe(false));
  expect(markers(view)).toHaveLength(12);
  settleHyphenation(view); expect(markers(view)).toHaveLength(12);
});

it('leaves the composing DOM intact', async () => {
  const view = await fixture();
  Object.defineProperty(view, 'composing', { configurable: true, get: () => true });
  settleHyphenation(view); expect(markers(view)).toHaveLength(8);
});

it('keeps a typing burst current and compacts its markers after input becomes idle', async () => {
  const view = await fixture(); settleHyphenation(view);
  view.dispatch(view.state.tr.insertText('x', 2));
  await vi.waitFor(() => expect(hyphenationStatus(view).pending).toBe(false));
  settleHyphenation(view, true);
  expect(markers(view)).toHaveLength(4);
  view.dispatch(view.state.tr.insertText('y', 3));
  await vi.waitFor(() => expect(hyphenationStatus(view).pending).toBe(false));
  settleHyphenation(view, true);
  expect(markers(view)).toHaveLength(4);
  await vi.waitFor(() => expect(markers(view)).toHaveLength(0));
  expect(view.state.doc.firstChild!.textContent).toBe('pxyaragraph measured');
  expandHyphenation(view);
  expect(markers(view)).toHaveLength(8);
});

it('keeps the complete opportunities when removing them changes physical layout', async () => {
  const view = await fixture();
  const first = view.dom.firstElementChild as HTMLElement;
  vi.spyOn(first, 'getBoundingClientRect').mockImplementation(() => ({ height: first.querySelector('.discretionary-hyphen') ? 80 : 100, top: 0 }) as DOMRect);
  settleHyphenation(view);
  expect(first.querySelectorAll('.discretionary-hyphen')).toHaveLength(4);
  expect(view.dom.lastElementChild!.querySelectorAll('.discretionary-hyphen')).toHaveLength(0);
});
