import type { DocNode } from "./types";

/** Display-only copies use their paired live object's generated result. */
export function movedInlineAliases(document: DocNode, type: string) {
  const destinations = new Map<string, DocNode>(), sources: DocNode[] = [];
  const collect = (node: DocNode) => {
    const move = node.attrs?.revisionMove;
    if (move?.stamp?.move) {
      const key = `${move.stamp.id}:${move.part ?? 0}`;
      if (move.kind === "insertion") destinations.set(key, node);
      else sources.push(node);
    }
    node.content?.forEach(collect);
  };
  collect(document);
  const aliases = new Map<string, string>();
  const pair = (source: DocNode, target: DocNode | undefined) => {
    if (source.type !== target?.type) return;
    if (source.type === type && source.attrs?.blockId && target.attrs?.blockId)
      aliases.set(source.attrs.blockId, target.attrs.blockId);
    source.content?.forEach((child, index) => pair(child, target.content?.[index]));
  };
  for (const node of sources) {
    const move = node.attrs!.revisionMove, target = destinations.get(`${move.stamp.id}:${move.part ?? 0}`);
    pair(node, target);
  }
  return aliases;
}
