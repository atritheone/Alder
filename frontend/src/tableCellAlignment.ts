import type { Node as PMNode } from "prosemirror-model";
import { Decoration, type EditorView } from "prosemirror-view";
import type { FlowPage, PageLayout } from "./pageFlow";
import {
  parallelTableRows,
  parallelMergedRows,
  tableRowBoundary,
} from "./tableStructure";
import { TableMap } from "prosemirror-tables";
import { pageRanges, pagesInRange } from "./pageRanges";
import { pageFrame } from "./sectionLayout";
import { pageInsets } from "./pageGeometry";

type Cell = { node: PMNode; pos: number; row: number; span: number };
type Row = { node: PMNode; pos: number; cells: Cell[] };
type Fragment = {
  from: number;
  to: number;
  pos: number;
  node: PMNode;
  top: number;
  bottom: number;
  whole: boolean;
};
const cache = new WeakMap<PMNode, { rows: Row[]; decorations: Decoration[] }>();
/** Top-align the native grid while measuring. The authored cell property stays
 * in the model; a later projection aligns each physical fragment independently. */
export function tableAlignmentBase(doc: PMNode) {
  const previous = cache.get(doc);
  if (previous) return previous;
  const rows: Row[] = [],
    decorations: Decoration[] = [];
  doc.descendants((table, pos) => {
    if (
      table.type.name !== "table" ||
      !(parallelTableRows(table) || parallelMergedRows(table))
    )
      return;
    const map = TableMap.get(table);
    let group: Row | null = null;
    table.forEach((row, rowOffset, rowIndex) => {
      if (tableRowBoundary(map, rowIndex)) {
        group = { node: row, pos: pos + 1 + rowOffset, cells: [] };
        rows.push(group);
      }
      const cells: Cell[] = [];
      row.forEach((cell, cellOffset) =>
        cells.push({
          node: cell,
          pos: pos + 2 + rowOffset + cellOffset,
          row: rowIndex,
          span: Number(cell.attrs.rowspan || 1),
        }),
      );
      group!.cells.push(...cells);
      for (const cell of cells)
        if (["middle", "bottom"].includes(cell.node.attrs.verticalAlign))
          decorations.push(
            Decoration.node(cell.pos, cell.pos + cell.node.nodeSize, {
              style: "vertical-align:top",
            }),
          );
    });
    return false;
  });
  const result = {
    rows: rows.filter((row) =>
      row.cells.some((cell) =>
        ["middle", "bottom"].includes(cell.node.attrs.verticalAlign),
      ),
    ),
    decorations,
  };
  cache.set(doc, result);
  return result;
}

export function alignedTableCells(
  view: EditorView,
  rows: Row[],
  pages: FlowPage[],
  layout: PageLayout,
  scale: number,
) {
  const decorations: Decoration[] = [];
  const origin = view.dom.closest(".flow-canvas")!.getBoundingClientRect().top;
  for (const row of rows) {
    const measured = row.cells.map((cell) => {
      const element = view.nodeDOM(cell.pos) as HTMLElement,
        css = getComputedStyle(element),
        fragments = new Map<number, Fragment[]>();
      cell.node.forEach((node, offset) => {
        const pos = cell.pos + 1 + offset,
          start = node.isLeaf ? pos : pos + 1,
          end = node.isLeaf ? pos + node.nodeSize : pos + node.nodeSize - 1;
        const block = view.nodeDOM(pos) as HTMLElement,
          rect = block.getBoundingClientRect();
        const wrapped = [
          ...block.querySelectorAll<HTMLElement>('[data-image-wrap="left"],[data-image-wrap="right"]'),
        ].map((image) => image.getBoundingClientRect());
        for (const page of pagesInRange(pages, start, end))
          for (const range of pageRanges(pages[page])) {
            const from = Math.max(start, range.from),
              to = Math.min(end, range.to);
            if (to < from || (to === from && start !== end)) continue;
            // The interval is half-open. A caret at its end can already belong
            // to the following sheet, particularly after an explicit line break.
            const whole = from === start && to === end,
              first = view.coordsAtPos(from, 1),
              last = view.coordsAtPos(Math.max(from, to - 1), 1);
            const frame = pageFrame(pages, page, layout),
              inset = pageInsets(frame.layout);
            const pictures = wrapped.filter(
              (image) =>
                (image.top - origin) / scale >= frame.top + inset.top - 0.5 &&
                (image.bottom - origin) / scale <=
                  frame.top + frame.layout.height - inset.bottom + 0.5,
            );
            const fragment = {
              from,
              to,
              pos,
              node,
              whole,
              top:
                (Math.min(
                  whole ? rect.top : first.top,
                  ...pictures.map((image) => image.top),
                ) -
                  origin) /
                scale,
              bottom:
                (Math.max(
                  whole ? rect.bottom : last.bottom,
                  ...pictures.map((image) => image.bottom),
                ) -
                  origin) /
                scale,
            };
            const found = fragments.get(page) || [];
            found.push(fragment);
            fragments.set(page, found);
          }
      });
      return {
        cell,
        fragments,
        paddingTop: parseFloat(css.paddingTop) || 0,
        paddingBottom: parseFloat(css.paddingBottom) || 0,
        border: (parseFloat(css.borderBottomWidth) || 0) / 2,
        rect: element.getBoundingClientRect(),
      };
    });
    const indices = [
      ...new Set(measured.flatMap((cell) => [...cell.fragments.keys()])),
    ];
    const rowRect = (
      view.nodeDOM(row.pos) as HTMLElement
    ).getBoundingClientRect();
    for (const page of indices) {
      const current = measured.flatMap((cell) => {
        const fragments = cell.fragments.get(page);
        return fragments?.length
          ? [
              {
                ...cell,
                parts: fragments,
                top: Math.min(...fragments.map((f) => f.top)),
                bottom: Math.max(...fragments.map((f) => f.bottom)),
              },
            ]
          : [];
      });
      if (!current.length) continue;
      const frame = pageFrame(pages, page, layout),
        margins = pageInsets(frame.layout);
      // For a split row, align to its occupied lines on this sheet, as Word
      // does. An unsplit row additionally honours an authored minimum height.
      const rowTop =
        indices.length === 1
          ? (rowRect.top - origin) / scale
          : Math.min(...current.map((c) => c.top - c.paddingTop - c.border));
      const rowBottom =
        indices.length === 1
          ? (rowRect.bottom - origin) / scale
          : Math.max(
              ...current.map((c) => c.bottom + c.paddingBottom + c.border),
            );
      for (const cell of current) {
        const alignment = cell.cell.node.attrs.verticalAlign;
        if (!["middle", "bottom"].includes(alignment)) continue;
        const merged = row.cells.some((c) => c.span > 1);
        const peers = current.filter(
          (other) =>
            other.cell.row < cell.cell.row + cell.cell.span &&
            other.cell.row + other.cell.span > cell.cell.row,
        );
        const cellTop = merged
          ? indices.length === 1
            ? (cell.rect.top - origin) / scale
            : Math.max(
                (cell.rect.top - origin) / scale,
                Math.min(...peers.map((c) => c.top - c.paddingTop - c.border)),
              )
          : rowTop;
        const cellBottom = merged
          ? indices.length === 1
            ? (cell.rect.bottom - origin) / scale
            : Math.min(
                (cell.rect.bottom - origin) / scale,
                Math.max(
                  ...peers.map((c) => c.bottom + c.paddingBottom + c.border),
                ),
              )
          : rowBottom;
        const top =
          Math.max(cellTop, frame.top + margins.top) +
          cell.paddingTop +
          cell.border;
        const bottom =
          Math.min(
            cellBottom,
            frame.top + frame.layout.height - margins.bottom,
          ) -
          cell.paddingBottom -
          cell.border;
        const height = cell.bottom - cell.top;
        const shift = Math.max(
          0,
          (alignment === "middle"
            ? top + (bottom - top - height) / 2
            : bottom - height) - cell.top,
        );
        if (shift < 0.1) continue;
        for (const part of cell.parts) {
          if (part.whole)
            decorations.push(
              Decoration.node(part.pos, part.pos + part.node.nodeSize, {
                class: "cell-alignment-paragraph",
                style: `transform:translateY(${shift}px)`,
              }),
            );
          else if (part.to > part.from)
            decorations.push(
              Decoration.inline(part.from, part.to, {
                class: "cell-alignment-fragment",
                style: `--cell-fragment-y:${shift}px;position:relative;top:calc(var(--column-fragment-y,0px) + ${shift}px)`,
              }),
            );
        }
      }
    }
  }
  return decorations;
}
