import type { Node as PMNode } from "prosemirror-model";
import { Decoration, type EditorView } from "prosemirror-view";
import { parallelCellStories } from "./tableStructure";

type Cell = { pos: number; row: number; span: number };
type Table = { rows: { pos: number; node: PMNode }[]; cells: Cell[] };
const cache = new WeakMap<PMNode, Table[]>();

export function mergedTableRows(doc: PMNode) {
  const found = cache.get(doc);
  if (found) return found;
  const tables: Table[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "table" || !parallelCellStories(node)) return;
    const table: Table = { rows: [], cells: [] };
    node.forEach((row, offset, index) => {
      table.rows.push({ pos: pos + 1 + offset, node: row });
      row.forEach((cell, cellOffset) =>
        table.cells.push({
          pos: pos + 2 + offset + cellOffset,
          row: index,
          span: Number(cell.attrs.rowspan || 1),
        }),
      );
    });
    if (table.cells.some((cell) => cell.span > 1)) tables.push(table);
  });
  cache.set(doc, tables);
  return tables;
}

/** Grow a spanning cell's final row. Browser table layout distributes excess
 * height among earlier rows too, moving already-paginated neighbouring text.
 * Explicit intrinsic row minima keep those earlier row origins stable. */
export function mergedRowHeights(
  view: EditorView,
  tables: Table[],
  scale: number,
) {
  const decorations: Decoration[] = [];
  for (const table of tables) {
    const heights = table.rows.map(
      (row) => (Number(row.node.attrs.minHeight || 0) * 4) / 3,
    );
    const requirements = table.cells
      .map((cell) => {
        const element = view.nodeDOM(cell.pos) as HTMLElement;
        const css = getComputedStyle(element),
          rect = element.getBoundingClientRect();
        // Qualified stories use normal block flow. Only the final child is
        // needed; rescanning every paragraph for each page break is quadratic.
        const last = element.lastElementChild;
        const blockBottom = last
          ? last.getBoundingClientRect().bottom +
            (parseFloat(getComputedStyle(last).marginBottom) || 0) * scale
          : rect.top;
        const bottom = Math.max(
          blockBottom,
          ...[
            ...element.querySelectorAll<HTMLElement>('[data-image-wrap="left"],[data-image-wrap="right"]'),
          ].map(
            (image) =>
              image.getBoundingClientRect().bottom +
              (parseFloat(getComputedStyle(image).marginBottom) || 0) * scale,
          ),
        );
        return {
          ...cell,
          height:
            (bottom - rect.top) / scale +
            (parseFloat(css.paddingBottom) || 0) +
            (parseFloat(css.borderBottomWidth) || 0) / 2,
        };
      })
      .sort((a, b) => a.span - b.span || a.row - b.row);
    for (const cell of requirements) {
      const end = Math.min(heights.length, cell.row + cell.span);
      const total = heights
        .slice(cell.row, end)
        .reduce((sum, height) => sum + height, 0);
      heights[end - 1] += Math.max(0, cell.height - total);
    }
    table.rows.forEach((row, index) =>
      decorations.push(
        Decoration.node(row.pos, row.pos + row.node.nodeSize, {
          style: `height:${heights[index]}px`,
        }),
      ),
    );
  }
  return decorations;
}
