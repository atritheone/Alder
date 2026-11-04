// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { schema } from './Editor';
import { hasParagraphPaint } from './paragraphPaintCandidates';
import type { NamedStyle } from './types';
const p = (attrs: Record<string, unknown> = {}) => schema.node('paragraph', attrs, schema.text('Words'));
const doc = (...nodes: ReturnType<typeof p>[]) => schema.node('doc', null, nodes);

it('recognises new appearance and complex containers while reusing unchanged prose', () => {
  const first = p(), second = p();
  expect(hasParagraphPaint(doc(first, second))).toBe(false);
  expect(hasParagraphPaint(doc(first, p({paragraphBackground:'#eeeeee'})))).toBe(true);
  expect(hasParagraphPaint(doc(first, schema.node('blockquote', null, second)))).toBe(true);
  expect(hasParagraphPaint(doc(first, schema.node('bullet_list', null, schema.node('list_item', null, second))))).toBe(true);
  expect(hasParagraphPaint(doc(first, second))).toBe(false);
});

it('invalidates inherited paragraph paint when a named style changes', () => {
  const document = doc(p({styleId:'body'}));
  const styles = [{id:'body',name:'Body',kind:'paragraph'}] as NamedStyle[];
  expect(hasParagraphPaint(document, styles)).toBe(false);
  expect(hasParagraphPaint(document, [{...styles[0], paragraphBorderWidth:1}])).toBe(true);
  expect(hasParagraphPaint(document, styles)).toBe(false);
});
