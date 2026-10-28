import { describe, expect, it } from "vitest";
import { EditorState } from "prosemirror-state";
import { closeHistory, history, undo, redo } from "prosemirror-history";
import { schema } from "./Editor";
import { documentOutline, moveOutlineSection } from "./documentOutline";

const heading = (id: string, level: number, text = id) =>
  schema.node("heading", { blockId: id, level }, schema.text(text));
const paragraph = (text: string) =>
  schema.node(
    "paragraph",
    { blockId: text },
    schema.text(text, [schema.marks.em.create()]),
  );
const doc = () =>
  schema.node("doc", null, [
    paragraph("Preface"),
    heading("First", 1),
    paragraph("Body one"),
    heading("Child", 2),
    paragraph("Nested body"),
    heading("Second", 1),
    paragraph("Body two"),
    heading("Third", 1),
    paragraph("Body three"),
  ]);

describe("document outline", () => {
  it("tracks heading hierarchy and the full subordinate content range", () => {
    const outline = documentOutline(doc());
    expect(outline.map((item) => [item.id, item.parent])).toEqual([
      ["First", null],
      ["Child", "First"],
      ["Second", null],
      ["Third", null],
    ]);
    expect(outline[0].to).toBe(outline[2].from);
    expect(outline[1].to).toBe(outline[2].from);
    expect(outline[3].to).toBe(doc().content.size);
  });
  it("moves a whole section preserving IDs and marks, and undoes separately from typing", () => {
    let state = EditorState.create({ doc: doc(), plugins: [history()] });
    state = state.apply(state.tr.insertText("!", 2));
    const beforeMove = state.doc;
    state = state.apply(moveOutlineSection(state, "First", "Second", true)!);
    state = state.apply(closeHistory(state.tr));
    expect(documentOutline(state.doc).map((item) => item.id)).toEqual([
      "Second",
      "First",
      "Child",
      "Third",
    ]);
    expect(state.doc.textContent).toContain("FirstBody oneChildNested body");
    const moved = state.doc;
    undo(state, (tr) => {
      state = state.apply(tr);
    });
    expect(state.doc.eq(beforeMove)).toBe(true);
    redo(state, (tr) => {
      state = state.apply(tr);
    });
    expect(state.doc.eq(moved)).toBe(true);
    state.doc.descendants((node) => {
      if (node.type.name === "paragraph")
        expect(node.firstChild?.marks[0].type.name).toBe("em");
    });
  });
  it("refuses to move a section into its own children or use obsolete identities", () => {
    const state = EditorState.create({ doc: doc() });
    expect(moveOutlineSection(state, "First", "Child")).toBeNull();
    expect(moveOutlineSection(state, "missing", "Second")).toBeNull();
    expect(moveOutlineSection(state, "Second", "Second", true)).toBeNull();
  });
  it("navigates headings in a table without offering to move a partial cell", () => {
    const table = schema.node(
      "table",
      { blockId: "table" },
      schema.node(
        "table_row",
        null,
        schema.node("table_cell", null, heading("Cell", 2)),
      ),
    );
    const outline = documentOutline(
      schema.node("doc", null, [
        heading("First", 1),
        table,
        heading("Last", 1),
      ]),
    );
    expect(outline[1].movable).toBe(false);
    expect(outline[0].to).toBe(outline[2].from);
  });
});
