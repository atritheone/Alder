import { describe, expect, it } from "vitest";
import { EditorState, NodeSelection } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { schema } from "./Editor";
import { selectedImage, setImageProperties } from "./imageFormatting";

const image = (id: string) =>
  schema.nodes.image.create({
    blockId: id,
    assetId: "asset",
    src: "/api/projects/test/assets/asset",
    alt: "Original",
  });
describe("image properties", () => {
  it("updates the identified image and preserves its asset, proportions and undo", () => {
    const doc = schema.nodes.doc.create(null, [image("one"), image("two")]);
    let state = EditorState.create({
      doc,
      selection: NodeSelection.create(doc, 0),
      plugins: [history()],
    });
    expect(selectedImage(state)?.node.attrs.blockId).toBe("one");
    expect(
      setImageProperties("two", {
        width: 192,
        align: "right",
        alt: "Description",
        title: "Title",
      })(state, (tr) => {
        state = state.apply(tr);
      }),
    ).toBe(true);
    expect(state.doc.child(0).eq(doc.child(0))).toBe(true);
    expect(state.doc.child(1).attrs).toMatchObject({
      blockId: "two",
      assetId: "asset",
      width: 192,
      align: "right",
      alt: "Description",
      title: "Title",
    });
    expect(selectedImage(state)?.node.attrs.blockId).toBe("two");
    undo(state, (tr) => {
      state = state.apply(tr);
    });
    expect(state.doc.eq(doc)).toBe(true);
  });
  it("refuses removed identities and invalid dimensions", () => {
    const doc = schema.nodes.doc.create(null, [image("one")]);
    const state = EditorState.create({ doc });
    const values = { width: 96, align: "left", alt: "", title: null };
    expect(setImageProperties("removed", values)(state)).toBe(false);
    for (const width of [0, NaN, Infinity, -1, 10001])
      expect(setImageProperties("one", { ...values, width })(state)).toBe(
        false,
      );
    expect(setImageProperties("one", { ...values, width: null })(state)).toBe(
      true,
    );
  });
});
