import { expect, it } from "vitest";
import { Schema, type Node as PMNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { Decoration, DecorationSet, type DecorationSource } from "prosemirror-view";
import { createDecorations, filterDecorations, addDecorations } from "./decorationTree";

const schema = new Schema({ nodes: {
  doc: { content: "block+" }, paragraph: { group: "block", content: "text*" },
  blockquote: { group: "block", content: "block+" }, horizontal_rule: { group: "block" }, text: {},
} });
const paragraph = () => schema.node("paragraph", null, schema.text("A paragraph with words."));
const document = () => schema.node("doc", null, [
  ...Array.from({ length: 90 }, paragraph),
  schema.node("blockquote", null, Array.from({ length: 90 }, paragraph)),
  schema.node("horizontal_rule"),
]);
const widget = (pos: number, key: string) => Decoration.widget(pos, () => globalThis.document.createElement("span"), { key });
const entries = (source: DecorationSource) => {
  const result: unknown[] = [];
  source.forEachSet(set => result.push(...set.find().map(d => [d.from, d.to, d.spec])));
  return result;
};
function verify(expected: DecorationSource, actual: DecorationSource, doc: PMNode) {
  expect(entries(actual)).toEqual(entries(expected));
  doc.forEach((node, pos) => {
    const a = expected.forChild(pos, node), b = actual.forChild(pos, node);
    expect(entries(b)).toEqual(entries(a));
    if (!node.isLeaf) verify(a, b, node);
  });
}
function spans(doc: PMNode) {
  const result: Decoration[] = [];
  doc.descendants((node, pos) => {
    result.push(widget(pos, `boundary-${pos}`));
    if (!node.isTextblock) return;
    for (let offset = 1; offset < node.nodeSize - 1; offset += 3) result.push(widget(pos + offset, `${pos}-${offset}`));
    result.push(Decoration.node(pos, pos + node.nodeSize, { class: "node" }, { id: pos }));
    result.push(Decoration.inline(pos + 2, pos + 10, { class: "inline" }, { id: pos + 2 }));
    return false;
  });
  result.push(Decoration.inline(5, doc.content.size - 2, { class: "crossing" }, { id: "crossing" }));
  result.push(widget(doc.content.size, "ending"));
  // Upstream discards invalid inline/node spans; the fast builder must too.
  result.push(Decoration.inline(9, 9, { class: "invalid" }));
  result.push(Decoration.node(5, 12, { class: "invalid" }));
  return result.reverse();
}

it("matches upstream nesting, boundary widgets, crossing spans and validation without consuming the input", () => {
  const doc = document(), input = spans(doc), before = input.slice();
  const actual = createDecorations(doc, input), expected = DecorationSet.create(doc, input.slice());
  expect(input).toEqual(before);
  verify(expected, actual, doc);
});

it("preserves mapping and subsequent addition/removal through edits, joins and nested boundaries", () => {
  let state = EditorState.create({ doc: document() }), input = spans(state.doc);
  let expected = DecorationSet.create(state.doc, input.slice()), actual = createDecorations(state.doc, input);
  for (const edit of [
    (s: EditorState) => s.tr.insertText("New ", 3),
    (s: EditorState) => s.tr.join(s.doc.child(0).nodeSize),
    (s: EditorState) => s.tr.insert(0, paragraph()),
    (s: EditorState) => s.tr.delete(0, s.doc.child(0).nodeSize),
  ]) {
    const tr = edit(state); state = state.apply(tr);
    expected = expected.map(tr.mapping, state.doc); actual = actual.map(tr.mapping, state.doc);
    verify(expected, actual, state.doc);
  }
  const extra = spans(state.doc);
  expected = expected.add(state.doc, extra.slice()); actual = addDecorations(state.doc, actual, extra);
  verify(expected, actual, state.doc);
  const keep = (span: Decoration) => span.from % 3 !== 0;
  const original = actual.find();
  verify(expected.remove(expected.find().filter(span => !keep(span))), filterDecorations(actual, keep), state.doc);
  expect(actual.find()).toEqual(original);
  expect(filterDecorations(actual, () => true)).toBe(actual);
  expect(filterDecorations(actual, () => false)).toBe(DecorationSet.empty);
});
