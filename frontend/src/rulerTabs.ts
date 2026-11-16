import type { EditorState } from "prosemirror-state";
import type { Node } from "prosemirror-model";
import { resolveStyles } from "./styleResolution";
import type { NamedStyle } from "./types";
import type { TabStop } from "./tabStops";

export function paragraphTabs(
  node: Node,
  styles: ReturnType<typeof resolveStyles>,
): TabStop[] {
  return node.attrs.tabStops ?? styles.get(node.attrs.styleId)?.tabStops ?? [];
}

/** Show the first paragraph's stops when a selection has differing tabs. Editing
 * one marker is a delta, not permission to replace every paragraph's tab list. */
export function selectionRulerTabs(
  state: EditorState,
  namedStyles: NamedStyle[],
) {
  const styles = resolveStyles(namedStyles);
  const lists: TabStop[][] = [];
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node) => {
    if (node.isTextblock) lists.push(paragraphTabs(node, styles));
  });
  if (!lists.length && state.selection.$from.parent.isTextblock)
    lists.push(paragraphTabs(state.selection.$from.parent, styles));
  const stops = lists[0] || [];
  return {
    stops,
    mixed: lists.some((list) => JSON.stringify(list) !== JSON.stringify(stops)),
  };
}

export function applyRulerTabEdit(
  current: TabStop[],
  before: TabStop[],
  after: TabStop[],
): TabStop[] {
  const changed = (a: TabStop, b: TabStop) =>
    a.position === b.position && a.align === b.align && a.leader === b.leader;
  const removed = before
    .filter((stop) => !after.some((next) => changed(stop, next)))
    .map((stop) => stop.position);
  const added = after.filter(
    (stop) => !before.some((previous) => changed(stop, previous)),
  );
  const next = current.filter(
    (stop) =>
      !removed.includes(stop.position) &&
      !added.some((add) => add.position === stop.position),
  );
  next.push(...added);
  return next.length > 64
    ? current
    : next.sort((a, b) => a.position - b.position);
}
