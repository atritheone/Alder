import { expect, it } from "vitest";
import { Schema, type Node as PMNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { Decoration, DecorationSet, type DecorationSource } from "prosemirror-view";
import { indexedDecorations, sameDecorations } from "./indexedDecorations";

const schema = new Schema({ nodes: {
  doc: { content: "block+" },
  paragraph: { group: "block", content: "text*" },
  blockquote: { group: "block", content: "block+" },
  horizontal_rule: { group: "block" },
  text: {},
} });
const paragraph = () => schema.nodes.paragraph.create(null, schema.text("Some exact leading text."));
const document = () => schema.nodes.doc.create(null, Array.from({length: 150}, paragraph));
const collect = (source: DecorationSource) => {
  const spans: unknown[] = [];
  source.forEachSet(set => spans.push(...set.find().map(d => [d.from, d.to, d.spec])));
  return spans;
};
function verify(original: DecorationSource, result: DecorationSource, doc: PMNode) {
  expect(collect(result)).toEqual(collect(original));
  doc.forEach((node, pos) => {
    const expected = original.forChild(pos, node), actual = result.forChild(pos, node);
    expect(collect(actual)).toEqual(collect(expected));
    if (!node.isLeaf) verify(expected, actual, node);
  });
}
const decorate = (doc: PMNode) => {
  const spans: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    spans.push(Decoration.inline(pos + 1, pos + node.nodeSize - 1, { class: "exact" }, { id: pos }));
    spans.push(Decoration.widget(pos + 3, () => globalThis.document.createElement("span"), { key: `page-${pos}`, side: -1 }));
  });
  return DecorationSet.create(doc, spans);
};

it("compares mapped trees without ignoring changed positions, widget keys or attributes", () => {
  const state = EditorState.create({ doc: document() }), original = decorate(state.doc);
  const tr = state.tr.insertText("new ", 7);
  const a = original.map(tr.mapping, tr.doc), b = decorate(state.doc).map(tr.mapping, tr.doc);
  expect(sameDecorations(a, b)).toBe(true);
  expect(sameDecorations(a, original)).toBe(false);
  expect(sameDecorations(a, b.add(tr.doc, [Decoration.widget(5, () => globalThis.document.createElement("span"), { key: "changed-height" })]))).toBe(false);
  expect(sameDecorations(a, b.add(tr.doc, [Decoration.inline(5, 7, { class: "changed" })]))).toBe(false);
  const withoutHook: DecorationSet = Object.create(a);
  Object.defineProperty(withoutHook, "eq", { value: undefined });
  expect(sameDecorations(withoutHook, b)).toBe(false);
});

it("keeps persistent sets unchanged and preserves nested spans and widgets", () => {
  const doc = schema.nodes.doc.create(null, [
    ...document().content.content,
    schema.nodes.blockquote.create(null, document().content),
    schema.nodes.horizontal_rule.create(),
  ]);
  const original = decorate(doc), method = original.forChild;
  const indexed = indexedDecorations(original);
  expect(indexed).not.toBe(original);
  expect(indexedDecorations(original)).toBe(indexed);
  expect(indexedDecorations(indexed)).toBe(indexed);
  expect(original.forChild).toBe(method);
  verify(original, indexed, doc);
});

it("preserves decoration mapping, addition and removal across edits and paragraph joins", () => {
  let state = EditorState.create({ doc: document() }), original = decorate(state.doc);
  let indexed = indexedDecorations(original);
  for (const edit of [
    (s: EditorState) => s.tr.insertText("new ", 7),
    (s: EditorState) => s.tr.join(s.doc.child(0).nodeSize),
    (s: EditorState) => s.tr.insert(0, paragraph()),
    (s: EditorState) => s.tr.delete(0, s.doc.child(0).nodeSize),
  ]) {
    const tr = edit(state); state = state.apply(tr);
    original = original.map(tr.mapping, state.doc);
    indexed = indexedDecorations(indexed.map(tr.mapping, state.doc));
    verify(original, indexed, state.doc);
  }
  const extra = Decoration.inline(2, 5, {class: "extra"});
  original = original.add(state.doc, [extra]); indexed = indexed.add(state.doc, [extra]);
  verify(original, indexedDecorations(indexed), state.doc);
  verify(original.remove([extra]), indexedDecorations(indexed.remove([extra])), state.doc);
});

it("leaves cross-paragraph inline spans on the normal clipping path", () => {
  const doc = document(), source = decorate(doc);
  const original = source.add(doc, [Decoration.inline(2, doc.content.size - 2, {class: "comment"})]);
  expect(indexedDecorations(original)).toBe(original);
  verify(original, indexedDecorations(original), doc);
  expect(indexedDecorations(DecorationSet.empty)).toBe(DecorationSet.empty);
});

it("retains parent node attributes and boundary widgets without passing them to children", () => {
  const doc = document();
  const source = decorate(doc).add(doc, [
    Decoration.node(0, doc.child(0).nodeSize, {class: "paragraph"}),
    Decoration.widget(doc.child(0).nodeSize, () => globalThis.document.createElement("span"), {key: "boundary"}),
  ]);
  const result = indexedDecorations(source);
  expect(result).not.toBe(source);
  verify(source, result, doc);
  // Root rendering still obtains exactly the upstream local decorations.
  const local = (set: DecorationSet) => (set as unknown as { locals(node: PMNode): Decoration[] }).locals(doc);
  expect(local(result)).toEqual(local(source));
});
