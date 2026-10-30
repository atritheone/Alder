import { describe, expect, it } from "vitest";
import { EditorState, NodeSelection } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { schema } from "./Editor";
import { selectedImage, setImageProperties } from "./imageFormatting";
import { blockIdentities, identifiedDocument } from "./blockIdentities";
import { projectText, projectedRange } from "./textProjection";
import { proofreadingTransaction } from "./proofreadingEdits";
import { replaceMatches } from "./findText";
import { imageCrop, croppedImageSource } from "./imageCrop";
import { documentUnits, moveArrangementUnit } from "./arrangementUnits";
import { imageAnchors } from "./imageAnchors";

const image = (id: string) =>
  schema.nodes.image.create({
    blockId: id,
    assetId: "asset",
    src: "/api/projects/test/assets/asset",
    alt: "Original",
  });
it("anchors wrapping to the paragraph without losing marked text, identity or undo", () => {
  const picture = schema.nodes.inline_image.create({
    blockId: "anchor",
    src: "/picture.png",
    alt: "Picture",
  });
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, [
      schema.text("Before ", [schema.marks.strong.create()]),
      picture,
      schema.text("after."),
    ]),
    schema.nodes.paragraph.create(null, schema.text("Destination.")),
  ]);
  let state = EditorState.create({ doc, plugins: [history()] });
  expect(
    setImageProperties("anchor", {
      width: 100,
      align: "left",
      alt: "Picture",
      title: null,
      wrap: "right",
      wrapGap: 8,
    })(state, (tr) => (state = state.apply(tr))),
  ).toBe(true);
  expect(state.doc.firstChild!.firstChild!.attrs).toMatchObject({
    blockId: "anchor",
    wrap: "right",
    wrapGap: 8,
  });
  expect(state.doc.textContent).toBe(doc.textContent);
  expect(state.doc.firstChild!.child(1).marks[0].type.name).toBe("strong");
  const restored = schema.nodeFromJSON(state.doc.toJSON());
  expect(restored.firstChild!.firstChild!.attrs.wrap).toBe("right");
  const unit = documentUnits(state.doc).find(
    (unit) => unit.kind === "paragraph",
  )!;
  const moved = moveArrangementUnit(state, unit, state.doc.content.size)!;
  expect(moved.tr.doc.lastChild!.firstChild!.attrs.blockId).toBe("anchor");
  expect(moved.tr.doc.lastChild!.firstChild!.attrs.wrap).toBe("right");
  undo(state, (tr) => (state = state.apply(tr)));
  expect(state.doc.eq(doc)).toBe(true);
});
it("reanchors a sentence moved into other prose in the same undo group", () => {
  const picture = schema.nodes.inline_image.create({
    blockId: "anchor",
    src: "/picture.png",
    wrap: "left",
  });
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, [
      picture,
      schema.text("First sentence. Second sentence."),
    ]),
    schema.nodes.paragraph.create(
      null,
      schema.text("Destination. Other words."),
    ),
  ]);
  let state = EditorState.create({ doc, plugins: [history(), imageAnchors()] });
  const sentence = documentUnits(doc).find((unit) => unit.kind === "sentence")!;
  const moved = moveArrangementUnit(
    state,
    sentence,
    doc.firstChild!.nodeSize + 1 + 13,
  )!;
  state = state.applyTransaction(moved.tr).state;
  expect(state.doc.lastChild!.firstChild!.attrs.blockId).toBe("anchor");
  expect(state.doc.lastChild!.textContent).toContain("First sentence.");
  expect(state.doc.firstChild!.textContent).toBe("Second sentence.");
  undo(state, (tr) => (state = state.applyTransaction(tr).state));
  expect(state.doc.eq(doc)).toBe(true);
});
describe("image properties", () => {
  it("keeps crops non-destructive and independently undoable", () => {
    const doc = schema.nodes.doc.create(null, image("one"));
    let state = EditorState.create({ doc, plugins: [history()] });
    const crop = { left: 25, top: 0, right: 25, bottom: 0 };
    expect(
      setImageProperties("one", {
        width: 96,
        align: "left",
        alt: "Art",
        title: null,
        crop,
      })(state, (tr) => {
        state = state.apply(tr);
      }),
    ).toBe(true);
    expect(state.doc.firstChild!.attrs).toMatchObject({
      crop,
      assetId: "asset",
      src: "/api/projects/test/assets/asset",
    });
    expect(croppedImageSource(state.doc.firstChild!.attrs.src, crop)).toBe(
      "/api/projects/test/assets/asset?crop=25,0,25,0",
    );
    expect(
      setImageProperties("one", {
        width: 96,
        align: "left",
        alt: "Art",
        title: null,
        crop: null,
      })(state, (tr) => {
        state = state.apply(tr);
      }),
    ).toBe(true);
    expect(state.doc.firstChild!.attrs.crop).toBeNull();
    undo(state, (tr) => {
      state = state.apply(tr);
    });
    expect(state.doc.firstChild!.attrs.crop).toEqual(crop);
    undo(state, (tr) => {
      state = state.apply(tr);
    });
    expect(state.doc.eq(doc)).toBe(true);
    for (const invalid of [
      { left: 100 },
      { top: 50, bottom: 50 },
      { top: NaN },
      [],
    ])
      expect(() => imageCrop(invalid)).toThrow();
  });
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

describe("inline pictures", () => {
  const attrs = {
    blockId: "picture",
    src: "data:image/png;base64,placeholder",
    alt: "Art",
    width: 48,
  };
  const picture = () => schema.nodes.inline_image.create(attrs);
  it("converts placement inside a cell without losing text, marks, identity or undo", () => {
    const p = schema.nodes.paragraph.create({ align: "center" }, [
      schema.text("Before", [schema.marks.strong.create()]),
      picture(),
      schema.text("After"),
    ]);
    const doc = schema.nodes.doc.create(
      null,
      schema.nodes.table.create(
        null,
        schema.nodes.table_row.create(
          null,
          schema.nodes.table_cell.create(null, p),
        ),
      ),
    );
    const initial = identifiedDocument(doc);
    let state = EditorState.create({
      doc: initial,
      plugins: [history(), blockIdentities()],
    });
    const change = (placement: "inline" | "block") =>
      setImageProperties("picture", {
        width: 48,
        align: "right",
        alt: "Art",
        title: null,
        placement,
      })(state, (tr) => {
        state = state.applyTransaction(tr).state;
      });
    expect(change("block")).toBe(true);
    let cell = state.doc.firstChild!.firstChild!.firstChild!;
    expect(
      Array.from(
        { length: cell.childCount },
        (_, i) => cell.child(i).type.name,
      ),
    ).toEqual(["paragraph", "image", "paragraph"]);
    expect(cell.firstChild!.firstChild!.marks[0].type.name).toBe("strong");
    expect(cell.child(2).attrs.align).toBe("center");
    expect(state.doc.textContent).toBe("BeforeAfter");
    expect(selectedImage(state)!.node.attrs.blockId).toBe("picture");
    expect(change("inline")).toBe(true);
    expect(selectedImage(state)!.node.type.name).toBe("inline_image");
    undo(state, (tr) => {
      state = state.apply(tr);
    });
    expect(selectedImage(state)!.node.type.name).toBe("image");
    undo(state, (tr) => {
      state = state.apply(tr);
    });
    expect(state.doc.eq(initial)).toBe(true);
  });
  it("keeps images silent and outside adjacent spelling replacements", () => {
    const doc = schema.nodes.doc.create(
      null,
      schema.nodes.paragraph.create(null, [
        schema.text("wrng"),
        picture(),
        schema.text(" after"),
      ]),
    );
    expect(projectText(doc).text).toBe("wrng after");
    expect(projectedRange(doc, 0, 4)).toEqual({ from: 1, to: 5 });
    const state = EditorState.create({ doc });
    const changed = state.apply(
      proofreadingTransaction(state, "wrng after", [
        { start: 0, end: 4, originalText: "wrng", replacement: "wrong" },
      ]),
    );
    expect(changed.doc.firstChild!.child(1).attrs.blockId).toBe("picture");
    expect(() =>
      proofreadingTransaction(state, "wrng after", [
        {
          start: 0,
          end: 10,
          originalText: "wrng after",
          replacement: "sentence",
        },
      ]),
    ).toThrow(/object/);
    expect(() =>
      replaceMatches(state, [{ start: 0, end: 10 }], "sentence", "wrng after"),
    ).toThrow(/image/);
  });
});

it("retains the authored description when decorative status is toggled and undone", () => {
  const doc = schema.nodes.doc.create(null, [image("one")]);
  let state = EditorState.create({ doc, plugins: [history()] });
  setImageProperties("one", {
    width: null,
    align: "left",
    alt: "Original",
    title: "Original title",
    decorative: true,
  })(state, (tr) => (state = state.apply(tr)));
  expect(state.doc.firstChild!.attrs).toMatchObject({
    decorative: true,
    alt: "Original",
    title: "Original title",
  });
  undo(state, (tr) => (state = state.apply(tr)));
  expect(state.doc.eq(doc)).toBe(true);
});
