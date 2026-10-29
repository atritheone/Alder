import type { Node as PMNode } from "prosemirror-model";
import { Plugin, type Command } from "prosemirror-state";
import { splitBlock } from "prosemirror-commands";
import { Decoration, DecorationSet } from "prosemirror-view";
import { resolveStyles } from "./styleResolution";
import type { DocNode, NamedStyle, Project } from "./types";

export function advanceHeading(
  counts: number[],
  level: number,
  restart?: number | null,
) {
  const index = Math.max(0, Math.min(5, level - 1));
  counts[index] = restart ?? counts[index] + 1;
  counts.fill(0, index + 1);
  // Word displays the initial value for an unused ancestor without consuming
  // that ancestor's first number when its heading is eventually written.
  return counts
    .slice(0, index + 1)
    .map((value) => value || 1)
    .join(".");
}
const enabled = (
  attrs: Record<string, any>,
  styles: ReturnType<typeof resolveStyles>,
) =>
  attrs.headingNumbered ?? styles.get(attrs.styleId)?.headingNumbered ?? false;

export const splitNumberedHeading: Command = (state, dispatch) => {
  const parent = state.selection.$from.parent;
  if (parent.type.name !== "heading" || parent.attrs.headingStart == null)
    return false;
  return splitBlock(
    state,
    dispatch &&
      ((tr) => {
        const right = tr.selection.$from;
        if (right.parent.type.name === "heading")
          tr.setNodeMarkup(right.before(), undefined, {
            ...right.parent.attrs,
            headingStart: null,
          });
        dispatch(tr);
      }),
  );
};

const jsonOperations = new WeakMap<
  DocNode,
  { styles: NamedStyle[]; items: [number, number | null][] }
>();
export function chapterHeadingStarts(project: Project, chapterId: string) {
  const counts = [0, 0, 0, 0, 0, 0];
  let styles: ReturnType<typeof resolveStyles>;
  try {
    styles = resolveStyles(project.styles);
  } catch {
    return counts;
  } // The existing style editor reports the invalid chain.
  for (const chapter of project.book?.chapters || []) {
    if (chapter.id === chapterId) break;
    if (chapter.include === false) continue;
    let cached = jsonOperations.get(chapter.document);
    if (!cached || cached.styles !== project.styles) {
      const items: [number, number | null][] = [];
      const visit = (node: DocNode) => {
        if (node.type === "heading" && enabled(node.attrs || {}, styles))
          items.push([
            node.attrs?.level || 1,
            node.attrs?.headingStart ?? null,
          ]);
        node.content?.forEach(visit);
      };
      visit(chapter.document);
      cached = { styles: project.styles, items };
      jsonOperations.set(chapter.document, cached);
    }
    for (const [level, restart] of cached.items)
      advanceHeading(counts, level, restart);
  }
  return counts;
}

export function headingLabels(
  doc: PMNode,
  styles: NamedStyle[] = [],
  initial = [0, 0, 0, 0, 0, 0],
) {
  const resolved = resolveStyles(styles),
    counts = [...initial],
    result: { position: number; label: string }[] = [];
  doc.descendants((node, position) => {
    if (node.type.name === "heading" && enabled(node.attrs, resolved))
      result.push({
        position,
        label: advanceHeading(
          counts,
          node.attrs.level,
          node.attrs.headingStart,
        ),
      });
  });
  return result;
}

/** Derived markers never enter authored text or typing history, like list
 * markers. Reordering headings recalculates the same hierarchy for every view. */
export function headingNumbers(
  settings: () => { styles: NamedStyle[]; initial: number[]; enabled: boolean },
) {
  let previous:
    | {
        doc: PMNode;
        styles: NamedStyle[];
        key: string;
        decorations: DecorationSet;
      }
    | undefined;
  return new Plugin({
    props: {
      decorations(state) {
        const options = settings();
        if (!options.enabled) return null;
        const key = options.initial.join(",");
        if (
          previous?.doc === state.doc &&
          previous.styles === options.styles &&
          previous.key === key
        )
          return previous.decorations;
        let labels: ReturnType<typeof headingLabels>;
        try {
          labels = headingLabels(state.doc, options.styles, options.initial);
        } catch {
          return null;
        }
        const markers = labels.map(({ position, label }) =>
          Decoration.widget(
            position + 1,
            () => {
              const marker = document.createElement("span");
              marker.className = "heading-number";
              marker.textContent = label + "\u00a0";
              marker.style.whiteSpace = "pre";
              return marker;
            },
            { side: -1, key: `heading-number-${label}`, ignoreSelection: true },
          ),
        );
        const decorations = DecorationSet.create(state.doc, markers);
        previous = { doc: state.doc, styles: options.styles, key, decorations };
        return decorations;
      },
    },
  });
}
