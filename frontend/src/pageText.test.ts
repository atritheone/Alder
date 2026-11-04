import { expect, it } from "vitest";
import { Schema } from "prosemirror-model";
import { pageText } from "./pageText";

const schema = new Schema({ nodes: {
  doc: { content: "block+" }, paragraph: { group: "block", content: "inline*" },
  blockquote: { group: "block", content: "block+" },
  image: { group: "block", leafText: () => "Image" },
  hard_break: { group: "inline", inline: true },
  inline_leaf: { group: "inline", inline: true, leafText: () => "leaf" },
  text: { group: "inline" },
} });
const p = (text = "") => schema.node("paragraph", null, text ? schema.text(text) : undefined);

it("matches every native range boundary across empty blocks, nested prose, Unicode and leaf text", () => {
  const doc = schema.node("doc", null, [
    p(), p("A😀ไทย"), schema.node("blockquote", null, [p(), p("Nested")]),
    schema.node("paragraph", null, [schema.text("x"), schema.node("hard_break"), schema.node("inline_leaf"), schema.text("y")]),
    schema.node("image"), p(), p("End"),
  ]);
  const text = pageText(doc);
  for (let from = 0; from <= doc.content.size; from++)
    for (let to = from; to <= doc.content.size; to++)
      expect(text(from, to), `${from}:${to}`).toBe(doc.textBetween(from, to, "\n"));
});

it("extracts adjacent and overlapping page ranges after paragraph edits without stale text", () => {
  const doc = schema.node("doc", null, Array.from({length: 200}, (_, i) => p(`${i} paragraph with text`)));
  const changed = schema.node("doc", null, [p("new"), ...doc.content.content.slice(1, -1), p("last")]);
  for (const source of [doc, changed]) {
    const text = pageText(source);
    for (let from = 0; from < source.content.size; from += 73) {
      const to = Math.min(source.content.size, from + 137);
      expect(text(from, to)).toBe(source.textBetween(from, to, "\n"));
    }
  }
  expect(() => pageText(doc)(-1, 3)).toThrow(RangeError);
});
