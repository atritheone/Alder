import { describe, expect, it } from "vitest";
import { EditorState, type Command } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { CellSelection, TableMap } from "prosemirror-tables";
import { schema } from "./Editor";
import { blockIdentities } from "./blockIdentities";
import { moveTableRows, splitTable, joinTable } from "./tableStructure";

const cell = (text: string, attrs = {}, header = false) =>
  schema.node(
    header ? "table_header" : "table_cell",
    { blockId: `cell-${text}`, colwidth: [100], ...attrs },
    [schema.node("paragraph", { blockId: `text-${text}` }, schema.text(text))],
  );
const row = (id: string, cells = [cell(id)]) =>
  schema.node("table_row", { blockId: id }, cells);
const table = (id: string, content = [row("A"), row("B"), row("C")]) =>
  schema.node("table", { blockId: id }, content);
function selected(tables: any[], row = 0, index = 0) {
  const doc = schema.node("doc", null, tables);
  const pos = tables
    .slice(0, index)
    .reduce((sum, table) => sum + table.nodeSize, 0);
  return EditorState.create({
    doc,
    selection: CellSelection.create(
      doc,
      pos +
        1 +
        TableMap.get(tables[index]).map[
          row * TableMap.get(tables[index]).width
        ],
    ),
    plugins: [history(), blockIdentities()],
  });
}
const run = (state: EditorState, command: Command) => {
  let result = state;
  expect(
    command(state, (tr) => {
      result = state.apply(tr);
    }),
  ).toBe(true);
  result.doc.check();
  result.doc.descendants((node) => {
    if (node.type.name === "table")
      expect(TableMap.get(node).problems).toBeNull();
  });
  return result;
};
describe("table structure", () => {
  it("moves actual rows, including their headers, content and identities, in one undo", () => {
    const original = selected(
      [table("table", [row("A", [cell("A", {}, true)]), row("B"), row("C")])],
      1,
    );
    const moved = run(original, moveTableRows(-1));
    expect(moved.doc.firstChild!.child(0).attrs.blockId).toBe("B");
    expect(moved.doc.firstChild!.child(1).child(0).type.name).toBe(
      "table_header",
    );
    expect(moved.doc.textContent).toBe("BAC");
    expect(moveTableRows(-1)(moved)).toBe(false);
    const restored = run(moved, undo);
    expect(restored.doc.eq(original.doc)).toBe(true);
  });
  it("moves a rowspan as an intact row group and refuses to split through it", () => {
    const merged = table("merged", [
      row("A", [cell("A", { rowspan: 2 }), cell("B")]),
      row("C", [cell("C")]),
      row("D", [cell("D"), cell("E")]),
    ]);
    const original = selected([merged]);
    const moved = run(original, moveTableRows(1));
    expect(moved.doc.textContent).toBe("DEABC");
    expect(moved.doc.firstChild!.child(1).firstChild!.attrs.rowspan).toBe(2);
    expect(moved.doc.firstChild!.child(1).attrs.blockId).toBe("A");
    expect(run(moved, undo).doc.eq(original.doc)).toBe(true);
    const map = TableMap.get(merged),
      doc = original.doc;
    const lowerCell = EditorState.create({
      doc,
      selection: CellSelection.create(doc, 1 + map.map[3]),
    });
    expect(splitTable(lowerCell)).toBe(false);
  });
  it("splits and joins without changing rows, cell widths or identities", () => {
    const original = selected([table("table")], 1);
    const split = run(original, splitTable);
    expect(split.doc.childCount).toBe(2);
    expect(split.doc.child(0).attrs.blockId).toBe("table");
    expect(split.doc.child(1).attrs.blockId).toBeTruthy();
    expect(split.doc.child(1).attrs.blockId).not.toBe("table");
    expect(split.doc.child(1).firstChild!.attrs.blockId).toBe("B");
    const joined = run(split, joinTable(-1));
    expect(joined.doc.eq(original.doc)).toBe(true);
    expect(run(joined, undo).doc.eq(split.doc)).toBe(true);
    expect(run(split, undo).doc.eq(original.doc)).toBe(true);
  });
  it("joins the following table but refuses differing widths and intervening text", () => {
    const first = table("first", [row("A")]),
      second = table("second", [row("B")]);
    expect(run(selected([first, second]), joinTable(1)).doc.textContent).toBe(
      "AB",
    );
    const different = table("different", [
      row("C", [cell("C", { colwidth: [200] })]),
    ]);
    expect(joinTable(1)(selected([first, different]))).toBe(false);
    expect(
      joinTable(1)(
        selected([
          first,
          schema.node("paragraph", null, schema.text("Keep me")),
          second,
        ]),
      ),
    ).toBe(false);
    expect(splitTable(selected([first]))).toBe(false);
  });
});
