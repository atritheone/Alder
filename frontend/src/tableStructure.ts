import { Fragment, type Node as PMNode } from "prosemirror-model";
import { type Command, type EditorState } from "prosemirror-state";
import { closeHistory } from "prosemirror-history";
import {
  CellSelection,
  isInTable,
  selectedRect,
  TableMap,
} from "prosemirror-tables";

function context(state: EditorState) {
  if (!isInTable(state)) return null;
  const rect = selectedRect(state);
  return rect.map.problems?.length ? null : rect;
}
const rows = (table: PMNode) =>
  Array.from({ length: table.childCount }, (_, index) => table.child(index));
/** A rowspan is indivisible: its rows travel together, and cannot be split. */
export function tableRowBoundary(map: TableMap, row: number) {
  if (row <= 0 || row >= map.height) return true;
  for (let column = 0; column < map.width; column++)
    if (
      map.map[(row - 1) * map.width + column] ===
      map.map[row * map.width + column]
    )
      return false;
  return true;
}
const boundary = tableRowBoundary;
export function moveTableRows(direction: -1 | 1): Command {
  return (state, dispatch) => {
    const rect = context(state);
    if (!rect) return false;
    const { map, table, tableStart } = rect;
    let top = rect.top,
      bottom = rect.bottom;
    while (!boundary(map, top)) top--;
    while (!boundary(map, bottom)) bottom++;
    if (direction < 0 ? top === 0 : bottom === map.height) return false;
    const content = rows(table),
      count = bottom - top;
    let destination: number;
    if (direction < 0) {
      destination = top - 1;
      while (!boundary(map, destination)) destination--;
    } else {
      let next = bottom + 1;
      while (!boundary(map, next)) next++;
      destination = next - count;
    }
    if (!dispatch) return true;
    content.splice(destination, 0, ...content.splice(top, count));
    const result = table.copy(Fragment.fromArray(content));
    const tr = closeHistory(state.tr).replaceWith(
      tableStart - 1,
      tableStart - 1 + table.nodeSize,
      result,
    );
    const updated = TableMap.get(result);
    tr.setSelection(
      CellSelection.rowSelection(
        tr.doc.resolve(tableStart + updated.map[destination * map.width]),
        tr.doc.resolve(
          tableStart + updated.map[(destination + count) * map.width - 1],
        ),
      ),
    );
    dispatch(tr.scrollIntoView());
    return true;
  };
}

export const splitTable: Command = (state, dispatch) => {
  const rect = context(state);
  if (!rect || rect.top === 0 || !boundary(rect.map, rect.top)) return false;
  if (!dispatch) return true;
  const content = rows(rect.table);
  const before = rect.table.copy(
    Fragment.fromArray(content.slice(0, rect.top)),
  );
  const after = rect.table.type.create(
    { ...rect.table.attrs, blockId: null },
    content.slice(rect.top),
    rect.table.marks,
  );
  const from = rect.tableStart - 1;
  const tr = closeHistory(state.tr).replaceWith(
    from,
    from + rect.table.nodeSize,
    [before, after],
  );
  tr.setSelection(
    CellSelection.create(
      tr.doc,
      from + before.nodeSize + 1 + TableMap.get(after).map[0],
    ),
  );
  dispatch(tr.scrollIntoView());
  return true;
};

function widths(table: PMNode, map: TableMap) {
  return Array.from({ length: map.width }, (_, column) => {
    const pos = map.map[column],
      cell = table.nodeAt(pos)!;
    return cell.attrs.colwidth?.[column - map.findCell(pos).left] || 0;
  });
}
export function joinTable(direction: -1 | 1): Command {
  return (state, dispatch) => {
    const rect = context(state);
    if (!rect) return false;
    const at = state.doc.resolve(rect.tableStart - 1),
      index = at.index();
    const next = at.parent.maybeChild(index + direction);
    if (next?.type !== rect.table.type) return false;
    const nextMap = TableMap.get(next);
    if (
      nextMap.problems?.length ||
      rect.map.width !== nextMap.width ||
      JSON.stringify(widths(rect.table, rect.map)) !==
        JSON.stringify(widths(next, nextMap))
    )
      return false;
    for (const key of Object.keys(rect.table.attrs))
      if (
        key !== "blockId" &&
        JSON.stringify(rect.table.attrs[key]) !==
          JSON.stringify(next.attrs[key])
      )
        return false;
    if (!dispatch) return true;
    const first = direction < 0 ? next : rect.table,
      second = direction < 0 ? rect.table : next;
    const from = rect.tableStart - 1 - (direction < 0 ? next.nodeSize : 0);
    const joined = first.copy(first.content.append(second.content));
    const tr = closeHistory(state.tr).replaceWith(
      from,
      from + first.nodeSize + second.nodeSize,
      joined,
    );
    const row = direction < 0 ? next.childCount + rect.top : rect.top;
    tr.setSelection(
      CellSelection.create(
        tr.doc,
        from + 1 + TableMap.get(joined).map[row * rect.map.width],
      ),
    );
    dispatch(tr.scrollIntoView());
    return true;
  };
}
