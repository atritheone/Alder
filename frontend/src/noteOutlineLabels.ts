import type { Node as PMNode } from "prosemirror-model";
import { outlineListLayout } from "./outlineLists";
import { normaliseListOrders } from "./listFormatting";

/** A continued fragment cannot recalculate outline counters from its shortened
 * tree: earlier siblings and separated continuations have already disappeared.
 * Keep each remaining paragraph's label from the complete authored story. */
export function noteOutlineLabels(
  source: PMNode,
  remainder: PMNode,
  origins: readonly number[],
  suppressed: readonly number[],
): ReadonlyMap<number, string | null> {
  const markers = new Map(
    outlineListLayout(normaliseListOrders(source)).markers.map(
      ({ pos, label }) => [pos, label],
    ),
  );
  const original: (string | undefined)[] = [];
  source.descendants((node, pos) => {
    if (node.type.name === "paragraph") original.push(markers.get(pos + 1));
  });
  const hidden = new Set(suppressed),
    labels = new Map<number, string | null>();
  let index = 0;
  remainder.descendants((node, pos) => {
    if (node.type.name !== "paragraph") return;
    labels.set(
      pos + 1,
      hidden.has(index) ? null : (original[origins[index]] ?? null),
    );
    index++;
  });
  return labels;
}
