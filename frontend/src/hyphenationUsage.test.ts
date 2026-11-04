import { expect, it, vi } from "vitest";
import { Schema, type Node as PMNode } from "prosemirror-model";
import { Mapping, StepMap } from "prosemirror-transform";
import { HyphenationUsage } from "./hyphenationUsage";
const schema = new Schema({ nodes: { doc: { content: "paragraph+" }, paragraph: {content: "text*"}, text: {} } });
const p = (text: string) => schema.node("paragraph", null, schema.text(text));
const words = (node: PMNode) => new Set(node.textContent.split(" "));
const entry = (node: PMNode, from: number, language = "en") => ({node, from, to: from + node.nodeSize, language});

it("does not inspect unchanged paragraph words when text before them grows", () => {
  const collect = vi.fn(words), usage = new HyphenationUsage(collect);
  const first = p("one two"), last = p("two three");
  usage.update([entry(first, 0), entry(last, first.nodeSize)]);
  collect.mockClear();
  const edited = p("one two new");
  usage.update([entry(edited, 0), entry(last, edited.nodeSize)], new Mapping([new StepMap([first.nodeSize - 1, 0, 4])]));
  expect(collect.mock.calls.map(([node]) => node)).toEqual([first, edited]);
  expect(usage.ranges.get("en\0three")).toEqual({from: edited.nodeSize, to: edited.nodeSize + last.nodeSize});
  expect(usage.ranges.get("en\0new")).toEqual({from: 0, to: edited.nodeSize});
});

it("retains duplicate immutable paragraphs, moves, removals and later language changes", () => {
  const a = p("shared alpha"), b = p("shared beta"), usage = new HyphenationUsage(words);
  usage.update([entry(a, 0), entry(b, a.nodeSize), entry(a, a.nodeSize + b.nodeSize)]);
  usage.update([entry(b, 0), entry(a, b.nodeSize)], new Mapping([new StepMap([0, a.nodeSize, 0])]));
  expect(usage.ranges.has("en\0alpha")).toBe(true);
  usage.update([entry(a, 0), entry(b, a.nodeSize)], new Mapping());
  expect(usage.ranges.get("en\0alpha")!.from).toBe(0);
  expect(usage.ranges.get("en\0beta")!.to).toBeGreaterThanOrEqual(a.nodeSize + b.nodeSize);
  usage.update([entry(b, 0, "fr")], new Mapping([new StepMap([0, a.nodeSize, 0])]));
  expect([...usage.ranges.keys()].sort()).toEqual(["fr\0beta", "fr\0shared"]);
  usage.update([], new Mapping()); expect(usage.ranges.size).toBe(0);
});

it("rebuilds exact bounds when a replacement has no mapping", () => {
  const usage = new HyphenationUsage(words), node = p("word");
  usage.update([entry(node, 100)]);
  usage.update([entry(node, 0)]);
  expect(usage.ranges.get("en\0word")).toEqual({from: 0, to: node.nodeSize});
});
