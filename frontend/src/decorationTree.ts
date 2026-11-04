import type { Node as PMNode } from "prosemirror-model";
import { Decoration, DecorationSet } from "prosemirror-view";

type Span = Decoration & { copy(from: number, to: number): Decoration };
type Tree = DecorationSet & { local: readonly Decoration[]; children: readonly (number | DecorationSet)[] };
type Constructor = new (local: readonly Decoration[], children: readonly (number | DecorationSet)[]) => DecorationSet;
const SetConstructor = DecorationSet as unknown as Constructor;

// This optimisation uses the same checked internal tree contract as our child
// lookup index. Library changes fall back to its public persistent operations;
// no shared set, decoration or library prototype is ever mutated.
function tree(source: DecorationSet): Tree | undefined {
  const candidate = source as Tree;
  if (!Array.isArray(candidate.local) || !Array.isArray(candidate.children) || candidate.children.length % 3) return;
  if (candidate.local.some(span => !(span instanceof Decoration) || typeof (span as Span).copy !== "function")) return;
  let previous = -1;
  for (let i = 0; i < candidate.children.length; i += 3) {
    const from = candidate.children[i], to = candidate.children[i + 1], child = candidate.children[i + 2];
    if (typeof from !== "number" || typeof to !== "number" || from <= previous || to <= from || !(child instanceof DecorationSet)) return;
    previous = from;
  }
  return candidate;
}
const supportsTree = (() => {
  try {
    const probe = new SetConstructor([], []);
    return !!tree(probe) && probe.find().length === 0;
  } catch { return false; }
})();

/** Partition sorted spans once per level. The library's flat builder scans
 * every span for every sibling, which is costly for manuscript hyphenation. */
export function createDecorations(doc: PMNode, decorations: Decoration[]): DecorationSet {
  if (!supportsTree || decorations.length < 256 || decorations.some(span => typeof (span as Span).copy !== "function"))
    return DecorationSet.create(doc, decorations.slice());
  const spans = decorations.slice().sort((a, b) => a.from - b.from || a.to - b.to);
  const build = (node: PMNode, items: Decoration[], offset: number): DecorationSet => {
    const localise = (span: Decoration) => offset ? (span as Span).copy(span.from - offset, span.to - offset) : span;
    if (items.length < 256 || node.isLeaf) return DecorationSet.create(node, items.map(localise));
    const children: { node: PMNode; from: number; to: number; spans: Decoration[] }[] = [];
    node.forEach((child, from) => children.push({ node: child, from, to: from + child.nodeSize, spans: [] }));
    let index = 0;
    const local: Decoration[] = [];
    for (const span of items) {
      while (index < children.length && span.from >= children[index].to + offset) index++;
      const child = children[index];
      if (child && !child.node.isLeaf && span.from > child.from + offset && span.to < child.to + offset) child.spans.push(span);
      else local.push(localise(span));
    }
    // Let upstream validate parent spans (including invalid node/inline spans).
    const root = tree(DecorationSet.create(node, local));
    if (!root || root.children.length) return DecorationSet.create(node, items.map(localise));
    const branches: (number | DecorationSet)[] = [];
    for (const child of children) {
      if (!child.spans.length) continue;
      const result = build(child.node, child.spans, offset + child.from + 1);
      if (result !== DecorationSet.empty) branches.push(child.from, child.to, result);
    }
    return root.local.length || branches.length ? new SetConstructor(root.local, branches) : DecorationSet.empty;
  };
  return build(doc, spans, 0);
}

/** Keep unchanged branches by identity while visiting each decoration once. */
export function filterDecorations(source: DecorationSet, keep: (span: Decoration) => boolean): DecorationSet {
  const filter = (set: DecorationSet, offset: number): DecorationSet | undefined => {
    const branch = tree(set);
    if (!branch) return;
    const local = branch.local.filter(span => keep(offset ? (span as Span).copy(span.from + offset, span.to + offset) : span));
    let changed = local.length !== branch.local.length;
    const children: (number | DecorationSet)[] = [];
    for (let i = 0; i < branch.children.length; i += 3) {
      const from = branch.children[i] as number, to = branch.children[i + 1] as number, old = branch.children[i + 2] as DecorationSet;
      const child = filter(old, offset + from + 1);
      if (!child) return;
      changed ||= child !== old;
      if (child !== DecorationSet.empty) children.push(from, to, child);
    }
    return !changed ? set : local.length || children.length ? new SetConstructor(local, children) : DecorationSet.empty;
  };
  return (supportsTree && filter(source, 0)) || source.remove(source.find().filter(span => !keep(span)));
}

export function addDecorations(doc: PMNode, source: DecorationSet, spans: Decoration[]) {
  return spans.length < 256 ? source.add(doc, spans.slice()) : createDecorations(doc, [...source.find(), ...spans]);
}
