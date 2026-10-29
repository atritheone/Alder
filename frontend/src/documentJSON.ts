import type { Node as PMNode } from "prosemirror-model";
import type { DocNode } from "./types";

// ProseMirror nodes are immutable. Reuse JSON for unchanged branches instead
// of allocating every paragraph and text run again after a local edit.
const cached = new WeakMap<PMNode, DocNode>();
const serialized = new WeakSet<object>();
export const isDocumentJSON = (value: object) => serialized.has(value);
export function documentJSON(node: PMNode): DocNode {
  const previous = cached.get(node);
  if (previous) return previous;
  const result: DocNode = { type: node.type.name };
  if (Object.keys(node.attrs).length)
    result.attrs = structuredClone(node.attrs);
  if (node.isText) result.text = node.text!;
  if (node.content.size) {
    result.content = [];
    node.forEach((child) => result.content!.push(documentJSON(child)));
  }
  if (node.marks.length)
    result.marks = node.marks.map((mark) => structuredClone(mark.toJSON()));
  cached.set(node, result);
  serialized.add(result);
  return result;
}
