import {
  Fragment,
  type Node as PMNode,
  type NodeSpec,
} from "prosemirror-model";
import {
  type Command,
  type EditorState,
  TextSelection,
} from "prosemirror-state";
import { closeHistory } from "prosemirror-history";
import {
  CellSelection,
  isInTable,
  selectedRect,
  TableMap,
  TableView,
} from "prosemirror-tables";

export const cellDefaults = {
  verticalAlign: "top",
  paddingTop: 5.25,
  paddingBottom: 5.25,
  paddingLeft: 5.25,
  paddingRight: 5.25,
  borderWidth: 0.75,
  borderColor: "#999999",
  background: null,
};
const color = (value: unknown) =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
function cssColor(value: string) {
  if (color(value)) return value;
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*1)?\)$/.exec(value);
  return rgb
    ? "#" +
        rgb
          .slice(1)
          .map((v) => Number(v).toString(16).padStart(2, "0"))
          .join("")
    : null;
}
const points = (value: string) =>
  /^\d+(?:\.\d+)?(?:pt|px)$/.test(value)
    ? parseFloat(value) * (value.endsWith("px") ? 0.75 : 1)
    : null;
const validNumber = (value: unknown, max: number) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= max;
export function cellStyle(attrs: Record<string, any>) {
  const css: string[] = [];
  for (const side of ["Top", "Bottom", "Left", "Right"])
    if (validNumber(attrs[`padding${side}`], 144))
      css.push(`padding-${side.toLowerCase()}:${attrs[`padding${side}`]}pt`);
  if (["top", "middle", "bottom"].includes(attrs.verticalAlign))
    css.push(`vertical-align:${attrs.verticalAlign}`);
  if (validNumber(attrs.borderWidth, 12))
    css.push(
      `border:${attrs.borderWidth}pt solid ${color(attrs.borderColor) ? attrs.borderColor : "#999999"}`,
    );
  else if (color(attrs.borderColor))
    css.push(`border-color:${attrs.borderColor}`);
  if (color(attrs.background)) css.push(`background-color:${attrs.background}`);
  return css.join(";");
}
export const tableCellAttributes = Object.fromEntries(
  Object.keys(cellDefaults).map((key) => [
    key,
    {
      default: null,
      getFromDOM(dom: HTMLElement) {
        if (key.startsWith("padding"))
          return points(dom.style[key as "paddingTop"]);
        if (key === "verticalAlign")
          return ["top", "middle", "bottom"].includes(dom.style.verticalAlign)
            ? dom.style.verticalAlign
            : null;
        if (key === "background") return cssColor(dom.style.backgroundColor);
        if (key === "borderColor") return cssColor(dom.style.borderTopColor);
        return dom.style.borderTopStyle === "none"
          ? 0
          : points(dom.style.borderTopWidth);
      },
      setDOMAttr(value: unknown, attrs: Record<string, any>) {
        const css = cellStyle({ [key]: value });
        if (css) attrs.style = (attrs.style ? attrs.style + ";" : "") + css;
      },
    },
  ]),
);

/** The resizing plugin owns table DOM; keep appearance in that same node view. */
export class AlderTableView extends TableView {
  constructor(node: PMNode, minimum: number) {
    super(node, minimum);
    this.appearance(node);
  }
  appearance(node: PMNode) {
    const align = node.attrs.align;
    this.table.style.marginLeft =
      align === "center" || align === "right" ? "auto" : "0";
    this.table.style.marginRight = align === "center" ? "auto" : "0";
    this.table.dataset.tableAlign = align || "left";
  }
  update(node: PMNode) {
    const result = super.update(node);
    if (result) this.appearance(node);
    return result;
  }
}
export function tableSpec(spec: NodeSpec): NodeSpec {
  return {
    ...spec,
    attrs: { ...spec.attrs, align: { default: "left" } },
    parseDOM: [
      {
        tag: "table",
        getAttrs: (dom) => ({
          align:
            dom.getAttribute("data-table-align") ||
            (dom.style.marginLeft === "auto"
              ? dom.style.marginRight === "auto"
                ? "center"
                : "right"
              : "left"),
        }),
      },
    ],
    toDOM: (node) => [
      "table",
      {
        "data-table-align": node.attrs.align,
        style: `margin-left:${node.attrs.align === "left" ? "0" : "auto"};margin-right:${node.attrs.align === "center" ? "auto" : "0"}`,
      },
      ["tbody", 0],
    ],
  };
}
export function rowSpec(spec: NodeSpec): NodeSpec {
  return {
    ...spec,
    attrs: { ...spec.attrs, minHeight: { default: null } },
    parseDOM: [
      {
        tag: "tr",
        getAttrs: (dom) => ({ minHeight: points(dom.style.height) }),
      },
    ],
    toDOM: (node) => [
      "tr",
      {
        style: validNumber(node.attrs.minHeight, 1440)
          ? `height:${node.attrs.minHeight}pt`
          : null,
      },
      0,
    ],
  };
}
export function tableContext(state: EditorState) {
  if (!isInTable(state)) return null;
  const rect = selectedRect(state);
  return rect.map.problems?.length ? null : rect;
}
export type TableAppearance = {
  table: Record<string, any>;
  cells: Record<string, any>;
  rows: Record<string, any>;
  columnWidth?: number;
};
export function selectedTableProperties(
  state: EditorState,
): (TableAppearance & { identity: string; columns: number }) | null {
  const rect = tableContext(state);
  if (!rect) return null;
  const cells = rect.map
    .cellsInRect(rect)
    .map((pos) => rect.table.nodeAt(pos)!);
  const mixed = (nodes: PMNode[], key: string, fallback: any) => {
    const values = nodes.map((node) => node.attrs[key] ?? fallback);
    return values.every((value) => value === values[0]) ? values[0] : undefined;
  };
  const widths = Array.from({ length: rect.right - rect.left }, (_, index) => {
    const column = rect.left + index,
      pos = rect.map.map[column];
    return (
      rect.table.nodeAt(pos)!.attrs.colwidth?.[
        column - rect.map.findCell(pos).left
      ] || 0
    );
  });
  return {
    identity: rect.table.attrs.blockId as string,
    table: { align: rect.table.attrs.align },
    cells: Object.fromEntries(
      Object.entries(cellDefaults).map(([key, value]) => [
        key,
        mixed(cells, key, value),
      ]),
    ),
    rows: {
      minHeight: mixed(
        Array.from({ length: rect.bottom - rect.top }, (_, i) =>
          rect.table.child(i + rect.top),
        ),
        "minHeight",
        null,
      ),
    },
    columns: rect.right - rect.left,
    columnWidth:
      widths[0] && widths.every((width) => width === widths[0])
        ? widths[0]
        : undefined,
  };
}
export function setTableProperties(
  identity: string,
  values: TableAppearance,
): Command {
  return (state, dispatch) => {
    const rect = tableContext(state);
    if (!rect || rect.table.attrs.blockId !== identity) return false;
    for (const [key, value] of Object.entries(values.cells)) {
      if (!(key in cellDefaults)) return false;
      if (value == null) continue;
      if (
        key.startsWith("padding")
          ? !validNumber(value, 144)
          : key === "borderWidth"
            ? !validNumber(value, 12)
            : key === "verticalAlign"
              ? !["top", "middle", "bottom"].includes(value)
              : !color(value)
      )
        return false;
    }
    if (
      values.table.align != null &&
      !["left", "center", "right"].includes(values.table.align)
    )
      return false;
    if (
      values.rows.minHeight != null &&
      !validNumber(values.rows.minHeight, 1440)
    )
      return false;
    if (
      values.columnWidth !== undefined &&
      (!Number.isInteger(values.columnWidth) ||
        values.columnWidth < 25 ||
        values.columnWidth > 10000)
    )
      return false;
    if (!dispatch) return true;
    const tr = closeHistory(state.tr);
    if (Object.keys(values.table).length)
      tr.setNodeMarkup(rect.tableStart - 1, undefined, {
        ...rect.table.attrs,
        ...values.table,
      });
    const selected = new Set(rect.map.cellsInRect(rect));
    rect.table.forEach((row, offset, index) => {
      if (
        index >= rect.top &&
        index < rect.bottom &&
        Object.keys(values.rows).length
      )
        tr.setNodeMarkup(rect.tableStart + offset, undefined, {
          ...row.attrs,
          ...values.rows,
        });
      row.forEach((cell, cellOffset) => {
        const pos = offset + 1 + cellOffset;
        const changes: Record<string, any> = selected.has(pos)
          ? values.cells
          : {};
        let colwidth = cell.attrs.colwidth;
        if (values.columnWidth !== undefined) {
          const cellRect = rect.map.findCell(pos);
          if (cellRect.left < rect.right && cellRect.right > rect.left) {
            colwidth = Array.from({ length: cell.attrs.colspan }, (_, col) =>
              col + cellRect.left >= rect.left &&
              col + cellRect.left < rect.right
                ? values.columnWidth
                : colwidth?.[col] || 0,
            );
          }
        }
        if (Object.keys(changes).length || colwidth !== cell.attrs.colwidth)
          tr.setNodeMarkup(rect.tableStart + pos, undefined, {
            ...cell.attrs,
            ...changes,
            colwidth,
          });
      });
    });
    dispatch(tr.scrollIntoView());
    return true;
  };
}
export function sizeTableColumns(widths: number[] | null): Command {
  return (state, dispatch) => {
    const rect = tableContext(state);
    if (
      !rect ||
      (widths &&
        (widths.length !== rect.map.width ||
          widths.some(
            (width) => !Number.isInteger(width) || width < 25 || width > 10000,
          )))
    )
      return false;
    if (!dispatch) return true;
    const tr = closeHistory(state.tr);
    for (const pos of new Set(rect.map.map)) {
      const cell = rect.table.nodeAt(pos)!;
      const { left, right } = rect.map.findCell(pos);
      tr.setNodeMarkup(rect.tableStart + pos, undefined, {
        ...cell.attrs,
        colwidth: widths?.slice(left, right) || null,
      });
    }
    dispatch(tr);
    return true;
  };
}
export function sortTableRows(direction: 1 | -1): Command {
  return (state, dispatch) => {
    const rect = tableContext(state);
    if (!rect || rect.table.childCount < 2) return false;
    const rows: PMNode[] = [];
    let merged = false;
    rect.table.forEach((row) => {
      rows.push(row);
      row.forEach((cell) => {
        if (cell.attrs.rowspan > 1 || cell.attrs.colspan > 1) merged = true;
      });
    });
    if (merged) return false;
    let header = 0;
    while (
      header < rows.length &&
      Array.from({ length: rows[header].childCount }, (_, i) =>
        rows[header].child(i),
      ).every((cell) => cell.type.spec.tableRole === "header_cell")
    )
      header++;
    if (rows.length - header < 2) return false;
    if (!dispatch) return true;
    const collator = new Intl.Collator(undefined, {
      numeric: true,
      sensitivity: "base",
    });
    const content = [
      ...rows.slice(0, header),
      ...rows
        .slice(header)
        .sort(
          (a, b) =>
            direction *
            collator.compare(
              a.child(rect.left).textContent,
              b.child(rect.left).textContent,
            ),
        ),
    ];
    const table = rect.table.copy(Fragment.fromArray(content));
    const tr = closeHistory(state.tr).replaceWith(
      rect.tableStart - 1,
      rect.tableStart - 1 + rect.table.nodeSize,
      table,
    );
    tr.setSelection(
      CellSelection.create(
        tr.doc,
        rect.tableStart +
          TableMap.get(table).map[header * rect.map.width + rect.left],
      ),
    );
    dispatch(tr.scrollIntoView());
    return true;
  };
}
/** Conversion is limited to text paragraphs so objects/structure cannot disappear. */
export function tableToText(separator = "\t"): Command {
  return (state, dispatch) => {
    const rect = tableContext(state);
    if (!rect) return false;
    let valid = true;
    rect.table.descendants((node) => {
      if (
        ![
          "table_row",
          "table_cell",
          "table_header",
          "paragraph",
          "heading",
          "text",
          "hard_break",
        ].includes(node.type.name)
      )
        valid = false;
    });
    if (!valid) return false;
    if (!dispatch) return true;
    const paragraphs: PMNode[] = [];
    for (let row = 0; row < rect.map.height; row++) {
      let content = Fragment.empty;
      for (let col = 0; col < rect.map.width; col++) {
        if (col)
          content = content.append(Fragment.from(state.schema.text(separator)));
        const pos = rect.map.map[row * rect.map.width + col],
          bounds = rect.map.findCell(pos);
        if (bounds.left !== col || bounds.top !== row) continue;
        rect.table.nodeAt(pos)!.forEach((block, _, index) => {
          if (index)
            content = content.append(
              Fragment.from(state.schema.nodes.hard_break.create()),
            );
          content = content.append(block.content);
        });
      }
      paragraphs.push(state.schema.nodes.paragraph.create(null, content));
    }
    const from = rect.tableStart - 1;
    const tr = closeHistory(state.tr).replaceWith(
      from,
      from + rect.table.nodeSize,
      paragraphs,
    );
    tr.setSelection(
      TextSelection.create(
        tr.doc,
        from + 1,
        from + paragraphs.reduce((sum, node) => sum + node.nodeSize, 0) - 1,
      ),
    );
    dispatch(tr.scrollIntoView());
    return true;
  };
}
export function textToTable(separator = "\t"): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    if (!separator || $from.depth > 1 || $to.depth > 1) return false;
    const first = $from.index(0);
    const last = $to.depth ? $to.index(0) : $to.index(0) - 1;
    const blocks: PMNode[] = [];
    for (let i = first; i <= last; i++) blocks.push(state.doc.child(i));
    if (
      !blocks.length ||
      blocks.length > 100 ||
      blocks.some(
        (block) =>
          block.type.name !== "paragraph" ||
          Array.from({ length: block.childCount }, (_, i) =>
            block.child(i),
          ).some((node) => !node.isText),
      )
    )
      return false;
    const rows = blocks.map((block) => {
      const segments: PMNode[] = [];
      let offset = 0;
      for (const text of block.textContent.split(separator)) {
        segments.push(
          state.schema.nodes.table_cell.create(
            null,
            state.schema.nodes.paragraph.create(
              {
                ...block.attrs,
                blockId: segments.length ? null : block.attrs.blockId,
              },
              block.content.cut(offset, offset + text.length),
            ),
          ),
        );
        offset += text.length + separator.length;
      }
      return segments;
    });
    const columns = Math.max(...rows.map((row) => row.length));
    if (columns < 2 || columns > 30) return false;
    if (!dispatch) return true;
    const table = state.schema.nodes.table.create(
      null,
      rows.map((cells) => {
        while (cells.length < columns)
          cells.push(state.schema.nodes.table_cell.createAndFill()!);
        return state.schema.nodes.table_row.create(null, cells);
      }),
    );
    const from = $from.depth ? $from.before(1) : $from.pos,
      to = $to.depth ? $to.after(1) : $to.pos;
    const tr = closeHistory(state.tr).replaceWith(from, to, table);
    tr.setSelection(CellSelection.create(tr.doc, from + 2));
    dispatch(tr.scrollIntoView());
    return true;
  };
}
