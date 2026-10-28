import { describe, expect, it } from "vitest";
import {
  AllSelection,
  EditorState,
  TextSelection,
  type Command,
} from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { CellSelection, TableMap } from "prosemirror-tables";
import { schema } from "./Editor";
import { blockIdentities } from "./blockIdentities";
import {
  selectedTableProperties,
  setTableProperties,
  sizeTableColumns,
  sortTableRows,
  tableToText,
  textToTable,
} from "./tableFormatting";

const p = (text: string, id = text) =>
  schema.node(
    "paragraph",
    { blockId: id },
    text ? schema.text(text, [schema.mark("em")]) : undefined,
  );
const cell = (text: string, attrs = {}, header = false) =>
  schema.node(
    header ? "table_header" : "table_cell",
    { blockId: "c-" + text, ...attrs },
    p(text),
  );
const row = (id: string, cells = [cell(id)]) =>
  schema.node("table_row", { blockId: id }, cells);
const table = (
  rows = [
    row("Header", [cell("Heading", {}, true), cell("Value", {}, true)]),
    row("a", [cell("Item 10"), cell("2")]),
    row("b", [cell("Item 2"), cell("1")]),
  ],
) => schema.node("table", { blockId: "table" }, rows);
function selected(node = table(), row = 1, col = 0) {
  const doc = schema.node("doc", null, [node]);
  return EditorState.create({
    doc,
    selection: CellSelection.create(
      doc,
      1 + TableMap.get(node).map[row * TableMap.get(node).width + col],
    ),
    plugins: [history(), blockIdentities()],
  });
}
function run(state: EditorState, command: Command) {
  let result = state;
  expect(
    command(state, (tr) => {
      result = state.applyTransaction(tr).state;
    }),
  ).toBe(true);
  result.doc.check();
  result.doc.descendants((node) => {
    if (node.type.name === "table")
      expect(TableMap.get(node).problems).toBeNull();
  });
  return result;
}
describe("table appearance and conversion", () => {
  it("applies to selected cells and rows, sizes the entire selected column, and undoes together", () => {
    const state = selected();
    const changed = run(
      state,
      setTableProperties("table", {
        table: { align: "right" },
        cells: {
          paddingLeft: 0,
          background: "#aabbcc",
          verticalAlign: "middle",
          borderWidth: 0,
        },
        rows: { minHeight: 40 },
        columnWidth: 150,
      }),
    );
    const t = changed.doc.firstChild!;
    expect(t.attrs.align).toBe("right");
    expect(t.child(1).attrs.minHeight).toBe(40);
    expect(t.child(0).attrs.minHeight).toBeNull();
    expect(t.child(1).child(0).attrs).toMatchObject({
      paddingLeft: 0,
      background: "#aabbcc",
      borderWidth: 0,
    });
    expect(t.child(1).child(1).attrs.background).toBeNull();
    expect(t.child(0).child(0).attrs.colwidth).toEqual([150]);
    expect(t.child(2).child(0).attrs.colwidth).toEqual([150]);
    expect(run(changed, undo).doc.eq(state.doc)).toBe(true);
    expect(
      setTableProperties("other", { table: {}, cells: {}, rows: {} })(state),
    ).toBe(false);
    expect(
      setTableProperties("table", {
        table: {},
        cells: { borderWidth: -1 },
        rows: {},
      })(state),
    ).toBe(false);
  });
  it("keeps merged-cell grid widths consistent when distributing or fitting", () => {
    const state = selected(
      table([
        row("r1", [cell("Merged", { colspan: 2 }), cell("C")]),
        row("r2", [cell("D"), cell("E"), cell("F")]),
      ]),
      0,
    );
    const sized = run(state, sizeTableColumns([100, 100, 100]));
    expect(
      sized.doc.firstChild!.firstChild!.firstChild!.attrs.colwidth,
    ).toEqual([100, 100]);
    expect(
      run(sized, sizeTableColumns(null)).doc.firstChild!.firstChild!.firstChild!
        .attrs.colwidth,
    ).toBeNull();
  });
  it("sorts numerically with headers fixed and identities, marks and undo intact", () => {
    const state = selected();
    const sorted = run(state, sortTableRows(1));
    expect(sorted.doc.firstChild!.child(0).attrs.blockId).toBe("Header");
    expect(sorted.doc.firstChild!.child(1).attrs.blockId).toBe("b");
    expect(sorted.doc.firstChild!.child(2).attrs.blockId).toBe("a");
    expect(
      sorted.doc.firstChild!.child(1).firstChild!.firstChild!.firstChild!
        .marks[0].type.name,
    ).toBe("em");
    expect(run(sorted, undo).doc.eq(state.doc)).toBe(true);
    const merged = selected(
      table([
        row("r1", [cell("Merged", { rowspan: 2 }), cell("C")]),
        row("r2", [cell("D")]),
      ]),
      0,
    );
    expect(sortTableRows(1)(merged)).toBe(false);
  });
  it("converts tab-separated paragraphs to a rectangular table without losing marks or empty cells", () => {
    const doc = schema.node("doc", null, [
      p("A\tB"),
      p("C\t\tD"),
      p("Untouched"),
    ]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(
        doc,
        1,
        doc.child(0).nodeSize + doc.child(1).nodeSize - 1,
      ),
      plugins: [history(), blockIdentities()],
    });
    const converted = run(state, textToTable());
    expect(TableMap.get(converted.doc.firstChild!).width).toBe(3);
    expect(converted.doc.firstChild!.child(1).child(1).textContent).toBe("");
    expect(converted.doc.lastChild!.textContent).toBe("Untouched");
    expect(
      converted.doc.firstChild!.firstChild!.firstChild!.firstChild!.firstChild!
        .marks[0].type.name,
    ).toBe("em");
    const restored = run(converted, tableToText());
    expect(restored.doc.child(0).textContent).toBe("A\tB\t");
    expect(restored.doc.child(1).textContent).toBe("C\t\tD");
    expect(run(converted, undo).doc.eq(state.doc)).toBe(true);
  });
  it("does not flatten embedded objects when converting tables to text", () => {
    const image = schema.node("image", { src: "asset:image" });
    const t = table([
      row("r", [schema.node("table_cell", null, [p("Keep"), image])]),
    ]);
    expect(tableToText()(selected(t, 0))).toBe(false);
  });
  it("supports Select All for text-to-table conversion", () => {
    const doc = schema.node("doc", null, [p("A\tB"), p("C\tD")]);
    const state = EditorState.create({ doc, selection: new AllSelection(doc) });
    const converted = run(state, textToTable());
    expect(converted.doc.childCount).toBe(1);
    expect(TableMap.get(converted.doc.firstChild!).height).toBe(2);
  });
  it("reports appearance for the selected cells without rewriting untouched properties", () => {
    const changed = run(
      selected(),
      setTableProperties("table", {
        table: { align: "center" },
        cells: {
          background: "#aabbcc",
          borderWidth: 2,
          borderColor: "#123456",
          paddingTop: 12,
          verticalAlign: "bottom",
        },
        rows: { minHeight: 36 },
      }),
    );
    const t = changed.doc.firstChild!;
    expect(t.attrs.align).toBe("center");
    expect(t.child(1).attrs.minHeight).toBe(36);
    expect(t.child(1).firstChild!.attrs).toMatchObject({
      background: "#aabbcc",
      borderWidth: 2,
      borderColor: "#123456",
      paddingTop: 12,
      verticalAlign: "bottom",
    });
    expect(selectedTableProperties(changed)?.cells.background).toBe("#aabbcc");
  });
});
