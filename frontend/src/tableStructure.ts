import { Fragment, type Node as PMNode } from "prosemirror-model";
import { type Command, EditorState, Selection } from "prosemirror-state";
import { closeHistory } from "prosemirror-history";
import { canSplit } from "prosemirror-transform";
import {
  CellSelection,
  isInTable,
  selectedRect,
  TableMap,
  addRowBefore,
  addRowAfter,
} from "prosemirror-tables";

function context(state: EditorState) {
  if (!isInTable(state)) return null;
  const rect = selectedRect(state);
  return rect.map.problems?.length ? null : rect;
}
const rows = (table: PMNode) =>
  Array.from({ length: table.childCount }, (_, index) => table.child(index));
/** Structural row moves/splits keep a rowspan's connected rows together.
 * Physical pagination may still divide the independent cell stories. */
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
export function insertDocumentTable(rows: number, columns: number): Command {
  return (state, dispatch) => {
    if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows<1 || columns<1 || rows>100 || columns>100) return false;
    const cell=()=>state.schema.nodes.table_cell.create(null,state.schema.nodes.paragraph.create());
    const row=()=>state.schema.nodes.table_row.create(null,Array.from({length:columns},cell));
    const table=state.schema.nodes.table.create(null,Array.from({length:rows},row));
    const tr=state.tr.deleteSelection(), at=tr.selection.$from;
    if (['paragraph','heading'].includes(at.parent.type.name)) {
      const container=at.node(-1), index=at.index(-1), fragment=Fragment.from(table);
      let pos:number;
      if (!at.parentOffset && container.canReplace(index,index,fragment)) pos=at.before();
      else if(at.parentOffset===at.parent.content.size && container.canReplace(index+1,index+1,fragment)) pos=at.after();
      else {
        if(!canSplit(tr.doc,at.pos))return false;
        tr.split(at.pos);pos=at.pos+1;
        const boundary=tr.doc.resolve(pos);
        if(!boundary.parent.canReplace(boundary.index(),boundary.index(),fragment))return false;
      }
      tr.insert(pos,table).setSelection(Selection.near(tr.doc.resolve(pos+4)));
    } else tr.replaceSelectionWith(table);
    dispatch?.(closeHistory(tr).scrollIntoView());return true;
  };
}
/** A row selection inserts the same number of rows, as one undoable command. */
export function insertTableRows(direction: -1 | 1): Command {
  return (state, dispatch) => {
    const rect=context(state);
    if(!rect)return false;
    if(!dispatch)return true;
    const count=state.selection instanceof CellSelection ? rect.bottom-rect.top : 1;
    const command=direction<0?addRowBefore:addRowAfter,tr=closeHistory(state.tr);
    for(let i=0;i<count;i++){
      const current=EditorState.create({doc:tr.doc,selection:tr.selection});
      if(!command(current,part=>{for(const step of part.steps)tr.step(step);tr.setSelection(part.selection.getBookmark().resolve(tr.doc));}))return false;
    }
    const table=tr.doc.nodeAt(rect.tableStart-1)!;
    let rowStart=rect.tableStart;
    for(let i=0;i<(direction<0?rect.top:rect.bottom);i++)rowStart+=table.child(i).nodeSize;
    tr.setSelection(Selection.near(tr.doc.resolve(rowStart+2),1));
    dispatch(tr.scrollIntoView());return true;
  };
}
/** Cell stories currently qualified for independent page fragments. */
export function parallelTableRows(table: PMNode): boolean {
  return Array.from({ length: table.childCount }, (_, i) =>
    table.child(i),
  ).every((row) =>
    Array.from({ length: row.childCount }, (_, i) => row.child(i)).every(
      (cell) =>
        Number(cell.attrs.rowspan || 1) === 1 &&
        Array.from({ length: cell.childCount }, (_, i) => cell.child(i)).every(
          (child) => child.isTextblock || child.type.name === 'image',
        ),
    ),
  );
}
/** A vertical merge keeps one cell story across its row group. */
export function parallelMergedRows(table: PMNode): boolean {
  let eligible = true;
  table.forEach((row) =>
    row.forEach((cell) => {
      cell.forEach((child) => {
        if (!child.isTextblock && child.type.name !== 'image') eligible = false;
      });
    }),
  );
  return eligible;
}
const parallelStories = new WeakMap<PMNode, boolean>();
/** Container stories retain their nested table/list structure during flow. */
export function parallelCellStories(table: PMNode): boolean {
  const cached = parallelStories.get(table);
  if (cached !== undefined) return cached;
  if (parallelMergedRows(table)) {
    parallelStories.set(table, true);
    return true;
  }
  let eligible = true;
  const block = (node: PMNode): boolean =>
    node.isTextblock || node.type.name === 'image' ||
    (node.type.name === "table"
      ? parallelCellStories(node)
      : ["blockquote", "bullet_list", "ordered_list", "list_item"].includes(
          node.type.name,
        ) &&
        Array.from({ length: node.childCount }, (_, i) => node.child(i)).every(
          block,
        ));
  table.forEach((row) =>
    row.forEach((cell) => {
      if (![null, undefined, "top"].includes(cell.attrs.verticalAlign))
        eligible = false;
      cell.forEach((child) => {
        if (!block(child)) eligible = false;
      });
    }),
  );
  parallelStories.set(table, eligible);
  return eligible;
}
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
    const offset=(index:number)=>tableStart+rows(table).slice(0,index).reduce((sum,row)=>sum+row.nodeSize,0);
    const from=offset(top),to=offset(bottom),target=offset(direction<0?destination:destination+count);
    const moved=content.slice(top,bottom);
    content.splice(destination, 0, ...content.splice(top, count));
    const result = table.copy(Fragment.fromArray(content));
    const tr=closeHistory(state.tr).delete(from,to);
    tr.insert(tr.mapping.map(target),Fragment.fromArray(moved));
    const updated = TableMap.get(result);
    tr.setSelection(
      CellSelection.rowSelection(
        tr.doc.resolve(tableStart + updated.map[destination * map.width]),
        tr.doc.resolve(
          tableStart + updated.map[(destination + count) * map.width - 1],
        ),
      ),
    );
    tr.setMeta('arrangementMove',{kind:'row',from,to,destination:target});
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
