import type { Node as PMNode } from "prosemirror-model";
import { Decoration, DecorationSet } from "prosemirror-view";

const indexed = new WeakMap<DecorationSet, DecorationSet>();

/** Use the installed library's subtree comparison when available. Its public
 * declarations omit this hook; newer implementations can fall back to paint. */
export function sameDecorations(a: DecorationSet, b: DecorationSet): boolean {
  if (a === b) return true;
  const eq = (a as unknown as { eq?: (other: DecorationSet) => boolean }).eq;
  return typeof eq === "function" && eq.call(a, b);
}

/** ProseMirror scans sibling decoration trees for every child. Large body
 * stories containing pagination/hyphenation spans in many paragraphs pay
 * that cost quadratically, including each intermediate pagination paint.
 *
 * Keep the original persistent set and all its operations. Only a set with no
 * local inline decorations can use this direct child lookup: inline spans at
 * the parent need ProseMirror's normal clipping/combination behaviour. The
 * internal tree shape is checked here; an incompatible library update simply
 * keeps the normal path. No shared set or library prototype is changed.
 */
export function indexedDecorations(source: DecorationSet): DecorationSet {
  const cached = indexed.get(source);
  if (cached) return cached;
  const tree = source as unknown as {
    local?: unknown[];
    children?: unknown[];
  };
  if (!Array.isArray(tree.local) ||
      !Array.isArray(tree.children) || tree.children.length / 3 + tree.local.length < 64 ||
      tree.children.length % 3) return source;
  // Node decorations and boundary widgets belong to the parent only; keep
  // them in locals() while excluding them from child lookups, as upstream does.
  if (tree.local.some(item => !(item instanceof Decoration) ||
      (item as unknown as { inline?: boolean }).inline !== false)) return source;
  const children = new Map<number, DecorationSet>();
  let previous = -1;
  for (let i = 0; i < tree.children.length; i += 3) {
    const from = tree.children[i], to = tree.children[i + 1], child = tree.children[i + 2];
    if (typeof from !== "number" || typeof to !== "number" ||
        from <= previous || to <= from || !(child instanceof DecorationSet))
      return source;
    previous = from;
    children.set(from, child);
  }
  const result: DecorationSet = Object.create(source);
  result.forChild = (offset: number, node: PMNode) => {
    if (node.isLeaf) return DecorationSet.empty;
    const child = children.get(offset);
    return child ? indexedDecorations(child) : DecorationSet.empty;
  };
  indexed.set(source, result);
  indexed.set(result, result);
  return result;
}
