import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { schema } from "./Editor";
import { blockIdentities } from "./blockIdentities";
import {
  selectedList,
  setListFormatting,
  continuedLists,
  normaliseListOrders,
} from "./listFormatting";

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

const para = (text: string) =>
  schema.node("paragraph", null, schema.text(text));
const listing = (text: string, attrs = {}) =>
  schema.node("ordered_list", attrs, [
    schema.node("list_item", null, para(text)),
  ]);
it("continues matching sibling lists, updates after editing, and undoes atomically", () => {
  const doc = schema.node("doc", null, [
    listing("First", { order: 4 }),
    para("Break"),
    listing("Second", { continuePrevious: true }),
  ]);
  let state = EditorState.create({
    doc: normaliseListOrders(doc),
    plugins: [history(), continuedLists()],
  });
  expect(state.doc.child(2).attrs.order).toBe(5);
  const before = state.doc;
  state = state.applyTransaction(
    state.tr.insert(1, schema.node("list_item", null, para("Added"))),
  ).state;
  expect(state.doc.child(2).attrs.order).toBe(6);
  undo(state, (tr) => (state = state.applyTransaction(tr).state));
  expect(state.doc.eq(before)).toBe(true);
});
it("keeps distinct markers, restarts and nested containers independent", () => {
  const doc = schema.node("doc", null, [
    listing("First", { order: 7 }),
    listing("Alpha", { order: 20, listStyle: "lower-alpha" }),
    schema.node("blockquote", null, [
      listing("Nested", { continuePrevious: true }),
    ]),
    listing("Next", { continuePrevious: true }),
    listing("Restart", { order: 2 }),
    listing("After restart", { continuePrevious: true }),
  ]);
  const result = normaliseListOrders(doc);
  expect(result.child(2).firstChild!.attrs.order).toBe(1);
  expect(result.child(3).attrs.order).toBe(8);
  expect(result.child(5).attrs.order).toBe(3);
});
it("continues from the selected item after a split in one undo", () => {
  let state = fixture().reconfigure({
    plugins: [history(), blockIdentities(), continuedLists()],
  });
  const original = state.doc;
  setListFormatting(
    "decimal",
    1,
    true,
    true,
  )(state, (tr) => (state = state.applyTransaction(tr).state));
  expect(state.doc.child(1).attrs).toMatchObject({
    continuePrevious: true,
    order: 5,
  });
  undo(state, (tr) => (state = state.applyTransaction(tr).state));
  expect(state.doc.eq(original)).toBe(true);
});
