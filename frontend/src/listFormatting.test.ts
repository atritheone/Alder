import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { schema } from "./Editor";
import { blockIdentities } from "./blockIdentities";
import { selectedList, setListFormatting } from "./listFormatting";

function fixture() {
  const doc = schema.node("doc", null, [
    schema.node(
      "ordered_list",
      { order: 4, blockId: "list-a" },
      ["One", "Two", "Three"].map((text, i) =>
        schema.node(
          "list_item",
          { blockId: `item-${i}` },
          schema.node("paragraph", { blockId: `p-${i}` }, schema.text(text)),
        ),
      ),
    ),
  ]);
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, 10),
    plugins: [history(), blockIdentities()],
  });
}
describe("list properties", () => {
  it("changes list markers and starting number without changing words or identities", () => {
    let state = fixture();
    const original = state.doc;
    expect(
      setListFormatting("upper-roman", 9)(state, (tr) => {
        state = state.apply(tr);
      }),
    ).toBe(true);
    expect(state.doc.firstChild!.attrs).toMatchObject({
      blockId: "list-a",
      listStyle: "upper-roman",
      order: 9,
    });
    expect(state.doc.textContent).toBe(original.textContent);
    expect(
      undo(state, (tr) => {
        state = state.apply(tr);
      }),
    ).toBe(true);
    expect(state.doc.eq(original)).toBe(true);
  });
  it("restarts at the current item in one undo and preserves nested content and the caret", () => {
    let state = fixture();
    const original = state.doc;
    expect(selectedList(state)?.index).toBe(1);
    setListFormatting(
      "lower-alpha",
      1,
      true,
    )(state, (tr) => {
      state = state.apply(tr);
    });
    expect(state.doc.childCount).toBe(2);
    expect(state.doc.child(0).attrs.order).toBe(4);
    expect(state.doc.child(0).attrs.blockId).toBe("list-a");
    expect(state.doc.child(1).attrs).toMatchObject({
      order: 1,
      listStyle: "lower-alpha",
    });
    expect(state.doc.child(1).attrs.blockId).not.toBe("list-a");
    expect(state.doc.child(1).firstChild!.attrs.blockId).toBe("item-1");
    expect(state.selection.$from.parent.textContent).toBe("Two");
    expect(
      undo(state, (tr) => {
        state = state.apply(tr);
      }),
    ).toBe(true);
    expect(state.doc.eq(original)).toBe(true);
  });
  it("rejects non-list contexts and incompatible markers", () => {
    const state = fixture();
    expect(setListFormatting("square", 1)(state)).toBe(false);
    expect(setListFormatting("decimal", 0)(state)).toBe(false);
    expect(
      setListFormatting("decimal", 1)(EditorState.create({ schema })),
    ).toBe(false);
  });
});
