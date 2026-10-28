import { describe, expect, it } from "vitest";
import { EditorState, TextSelection, AllSelection } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { schema } from "./Editor";
import { captureFormatting, pasteFormatting } from "./formatClipboard";

const p = (text: string, attrs = {}, marks: any[] = []) =>
  schema.node("paragraph", attrs, schema.text(text, marks));
const stateFor = (doc: any, start = 1, end = start) =>
  EditorState.create({
    doc,
    selection: TextSelection.create(doc, start, end),
    plugins: [history()],
  });
const source = () => {
  const doc = schema.node("doc", null, [
    p(
      "Source",
      { blockId: "source", styleId: "body", align: "right", spaceAfter: 18 },
      [
        schema.marks.em.create(),
        schema.marks.link.create({ href: "https://source.example" }),
        schema.marks.text_style.create({ styleId: "accent" }),
      ],
    ),
  ]);
  return captureFormatting(stateFor(doc, 1, 7), [
    {
      id: "body",
      name: "Body",
      fontFamily: "Cambria",
      fontSize: 14,
      keepTogether: true,
    },
    { id: "accent", name: "Accent", kind: "character", color: "#123456" },
  ])!;
};
const apply = (state: EditorState, copied = source()) => {
  let result = state;
  expect(
    pasteFormatting(copied)(state, (tr) => {
      result = result.apply(tr);
    }),
  ).toBe(true);
  return result;
};
describe("formatting clipboard", () => {
  it("copies resolved appearance without text, links or source style/block IDs", () => {
    const copied = source();
    expect(copied.paragraph).toMatchObject({
      align: "right",
      fontSize: 14,
      keepTogether: true,
    });
    expect(copied.marks).toContainEqual({
      type: "text_style",
      attrs: { color: "#123456", fontSize: 14, fontFamily: "Cambria" },
    });
    expect(JSON.stringify(copied)).not.toMatch(
      /source.example|source|accent|styleId|blockId|Source/,
    );
  });
  it("changes only selected characters, preserving target links and paragraph structure", () => {
    const doc = schema.node("doc", null, [
      p("Target text", { blockId: "target", align: "left" }, [
        schema.marks.strong.create(),
        schema.marks.link.create({ href: "https://target.example" }),
      ]),
    ]);
    const before = stateFor(doc, 4, 1),
      after = apply(before);
    expect(after.doc.firstChild!.attrs).toEqual(doc.firstChild!.attrs);
    expect(after.selection.anchor).toBe(4);
    expect(after.selection.head).toBe(1);
    const changed = after.doc.firstChild!.firstChild!;
    expect(changed.text).toBe("Tar");
    expect(schema.marks.link.isInSet(changed.marks)?.attrs.href).toBe(
      "https://target.example",
    );
    expect(schema.marks.em.isInSet(changed.marks)).toBeTruthy();
    expect(schema.marks.strong.isInSet(changed.marks)).toBeFalsy();
    expect(
      schema.marks.strong.isInSet(after.doc.firstChild!.lastChild!.marks),
    ).toBeTruthy();
    let restored = after;
    undo(after, (tr) => {
      restored = after.apply(tr);
    });
    expect(restored.doc.eq(doc)).toBe(true);
  });
  it("includes paragraph appearance for whole paragraphs and keeps target IDs", () => {
    const doc = schema.node("doc", null, [
      p("Target", { blockId: "target", styleId: "unrelated", align: "left" }),
    ]);
    const before = EditorState.create({
      doc,
      selection: new AllSelection(doc),
      plugins: [history()],
    });
    const after = apply(before);
    expect(after.doc.firstChild!.attrs).toMatchObject({
      blockId: "target",
      styleId: null,
      align: "right",
      spaceAfter: 18,
      fontSize: 14,
    });
    expect(after.doc.textContent).toBe("Target");
    let restored = after;
    undo(after, (tr) => {
      restored = after.apply(tr);
    });
    expect(restored.doc.eq(doc)).toBe(true);
  });
  it("sets future typing appearance at a caret without replacing existing text", () => {
    const doc = schema.node("doc", null, [p("Target", { blockId: "target" })]);
    const after = apply(stateFor(doc, 3));
    expect(after.doc.firstChild!.attrs.align).toBe("right");
    expect(after.doc.firstChild!.firstChild!.marks).toEqual([]);
    expect(schema.marks.em.isInSet(after.storedMarks!)).toBeTruthy();
    expect(after.apply(after.tr.insertText("X")).doc.textContent).toBe(
      "TaXrget",
    );
  });
  it("copies heading structure only where the destination schema allows it", () => {
    const heading = schema.node("doc", null, [
      schema.node("heading", { level: 2 }, schema.text("Heading")),
    ]);
    const copied = captureFormatting(stateFor(heading, 1, 8))!;
    const ordinary = schema.node("doc", null, [
      p("Target", { blockId: "target" }),
    ]);
    expect(
      apply(stateFor(ordinary, 1, 7), copied).doc.firstChild!.type.name,
    ).toBe("heading");
    const list = schema.node("doc", null, [
      schema.node("bullet_list", null, [
        schema.node("list_item", null, [p("Target", { blockId: "item" })]),
      ]),
    ]);
    const result = apply(stateFor(list, 3, 9), copied);
    expect(() => result.doc.check()).not.toThrow();
    expect(result.doc.firstChild!.firstChild!.firstChild!.type.name).toBe(
      "paragraph",
    );
    expect(result.doc.firstChild!.firstChild!.firstChild!.attrs.fontSize).toBe(
      20,
    );
  });
});
