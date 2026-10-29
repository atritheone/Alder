import { it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import { history, undo, redo, closeHistory } from "prosemirror-history";
import { schema } from "./Editor";
import { captionAnchors } from "./captionAnchors";

function fixture() {
  const image = schema.node("image", {
    src: "/api/projects/p/assets/a",
    blockId: "image",
  });
  const paragraph = (id: string, text: string) =>
    schema.node("paragraph", { blockId: id }, schema.text(text));
  const caption = schema.node(
    "paragraph",
    { blockId: "caption", captionLabel: "Figure", captionTargetId: "image" },
    schema.text("Figure 1: A picture"),
  );
  return schema.node("doc", null, [
    image,
    caption,
    paragraph("a", "First paragraph."),
    paragraph("b", "Second paragraph."),
  ]);
}
it("moves an adjacent caption with its object as one undoable event", () => {
  const doc = fixture();
  let state = EditorState.create({
    doc,
    plugins: [history(), captionAnchors()],
  });
  const dispatch = (tr: any) => {
    state = state.applyTransaction(tr).state;
  };
  const image = doc.firstChild!;
  const tr = closeHistory(state.tr).delete(0, image.nodeSize);
  tr.insert(tr.doc.content.size, image);
  dispatch(tr);
  expect(state.doc.lastChild?.attrs.blockId).toBe("caption");
  expect(state.doc.child(state.doc.childCount - 2).attrs.blockId).toBe("image");
  undo(state, dispatch);
  expect(state.doc.eq(doc)).toBe(true);
  redo(state, dispatch);
  expect(state.doc.lastChild?.attrs.blockId).toBe("caption");
});
it("does not relocate a separately moved caption or change typing into a full document operation", () => {
  const doc = fixture();
  let state = EditorState.create({ doc, plugins: [captionAnchors()] });
  const caption = doc.child(1),
    at = doc.firstChild!.nodeSize;
  const tr = state.tr.delete(at, at + caption.nodeSize);
  tr.insert(tr.doc.content.size, caption);
  let result = state.applyTransaction(tr);
  state = result.state;
  expect(result.transactions).toHaveLength(1);
  const point = state.doc.content.size - 1;
  result = state.applyTransaction(state.tr.insertText(" Extra title", point));
  expect(result.transactions).toHaveLength(1);
  expect(result.state.doc.lastChild?.textContent).toBe(
    "Figure 1: A picture Extra title",
  );
});
it("keeps an above-table caption above a moved table and respects selections containing both", () => {
  const table = schema.node(
    "table",
    { blockId: "table" },
    schema.node(
      "table_row",
      null,
      schema.node(
        "table_cell",
        null,
        schema.node("paragraph", null, schema.text("Cell")),
      ),
    ),
  );
  const caption = schema.node(
    "paragraph",
    { blockId: "caption", captionLabel: "Table", captionTargetId: "table" },
    schema.text("Table 1: Results"),
  );
  const body = schema.node("paragraph", null, schema.text("Body"));
  const doc = schema.node("doc", null, [caption, table, body]);
  let state = EditorState.create({ doc, plugins: [captionAnchors()] });
  const tr = state.tr.delete(
    caption.nodeSize,
    caption.nodeSize + table.nodeSize,
  );
  tr.insert(tr.doc.content.size, table);
  state = state.applyTransaction(tr).state;
  expect(state.doc.child(0).textContent).toBe("Body");
  expect(state.doc.child(1).attrs.captionTargetId).toBe("table");
  expect(state.doc.child(2).attrs.blockId).toBe("table");
  const pair = state.doc.slice(body.nodeSize).content;
  const move = state.tr
    .delete(body.nodeSize, state.doc.content.size)
    .insert(0, pair);
  const result = state.applyTransaction(move);
  expect(result.transactions).toHaveLength(1);
  expect(result.state.doc.eq(doc)).toBe(true);
});
