import {
  countColumn,
  findColumn,
  type ChangeSpec,
  type EditorState,
} from "@codemirror/state";

export function columnInsertion(
  line: string,
  column: number,
  value: string,
  tabSize: number,
): { from: number; to: number; insert: string } {
  const offset = findColumn(line, column, tabSize),
    at = countColumn(line, tabSize, offset);
  if (at < column)
    return {
      from: line.length,
      to: line.length,
      insert: " ".repeat(column - at) + value,
    };
  if (at > column && offset > 0 && line[offset - 1] === "\t") {
    const before = countColumn(line, tabSize, offset - 1);
    return {
      from: offset - 1,
      to: offset,
      insert: " ".repeat(column - before) + value + " ".repeat(at - column),
    };
  }
  return { from: offset, to: offset, insert: value };
}
export function columnChanges(
  state: EditorState,
  column: number,
  values: (index: number) => string,
): ChangeSpec[] {
  if (!Number.isInteger(column) || column < 0 || column > 10000)
    throw new Error("Use a column from 1 to 10,001.");
  const lines = new Set<number>();
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number,
      last = state.doc.lineAt(r.to).number;
    for (let n = first; n <= last; n++) {
      if (n > first && state.doc.line(n).from === r.to) break;
      lines.add(n);
    }
  }
  return [...lines]
    .sort((a, b) => a - b)
    .map((n, index) => {
      const line = state.doc.line(n),
        edit = columnInsertion(line.text, column, values(index), state.tabSize);
      return { ...edit, from: line.from + edit.from, to: line.from + edit.to };
    });
}
