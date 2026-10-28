import type { Node as PMNode } from "prosemirror-model";
import { TextSelection, type EditorState } from "prosemirror-state";
import { closeHistory } from "prosemirror-history";

export type OutlineHeading = {
  id: string;
  title: string;
  level: number;
  from: number;
  to: number;
  parent: string | null;
  movable: boolean;
};

/** Ranges refer to authored blocks, never to the derived page boundaries. */
export function documentOutline(doc: PMNode): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  const parents: OutlineHeading[] = [];
  doc.descendants((node, from) => {
    if (node.type.name !== "heading") return;
    const level = Number(node.attrs.level || 1);
    while (parents.length && parents.at(-1)!.level >= level) parents.pop();
    const item: OutlineHeading = {
      id: node.attrs.blockId || `position:${from}`,
      title: node.textContent.trim() || "Untitled heading",
      level,
      from,
      to: doc.content.size,
      parent: parents.at(-1)?.id || null,
      movable: doc.resolve(from).depth === 0 && Boolean(node.attrs.blockId),
    };
    headings.push(item);
    parents.push(item);
  });
  const following: OutlineHeading[] = [];
  for (let index = headings.length - 1; index >= 0; index--) {
    const item = headings[index];
    item.to =
      [...following].reverse().find((next) => next.level <= item.level)?.from ??
      doc.content.size;
    if (doc.resolve(item.from).depth === 0) {
      while (following.length && following.at(-1)!.level >= item.level)
        following.pop();
      following.push(item);
    }
  }
  return headings;
}

/** Moves a heading and its subordinate blocks as one history event. */
export function moveOutlineSection(
  state: EditorState,
  sourceId: string,
  targetId: string,
  after = false,
) {
  const headings = documentOutline(state.doc);
  const source = headings.find((item) => item.id === sourceId);
  const target = headings.find((item) => item.id === targetId);
  if (!source?.movable || !target?.movable || source.id === target.id)
    return null;
  const destination = after ? target.to : target.from;
  if (destination >= source.from && destination <= source.to) return null;
  const content = state.doc.slice(source.from, source.to).content;
  const tr = closeHistory(state.tr).delete(source.from, source.to);
  const at =
    destination > source.to
      ? destination - (source.to - source.from)
      : destination;
  tr.insert(at, content);
  tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)));
  return tr.scrollIntoView();
}
