import { describe, expect, it } from "vitest";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { schema, parseEditorDocument } from "./Editor";
import {
  selectionFormatting,
  setTextStyle,
  setParagraph,
  clearCharacterFormatting,
  toggleList,
  paragraphProperties,
} from "./editorCommands";
import { editorSession, rememberEditorSession } from "./editorSessions";
import { editorFontPoints, headingFormatting } from "./documentFormatting";

const run = (state: EditorState, command: Command) => {
  let result = state;
  expect(
    command(state, (tr) => {
      result = result.apply(tr);
    }),
  ).toBe(true);
  return result;
};
const document = () =>
  schema.node("doc", null, [
    schema.node("paragraph", { styleId: "body" }, [
      schema.text("First", [
        schema.marks.strong.create(),
        schema.marks.text_style.create({ color: "#123456", fontSize: 10 }),
      ]),
      schema.text(" second", [
        schema.marks.link.create({ href: "https://example.org" }),
        schema.marks.text_style.create({ color: "#654321", fontSize: 16 }),
      ]),
    ]),
  ]);
const selected = () => {
  const doc = document();
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, 1, 13),
    plugins: [history()],
  });
};
describe("shared formatting commands", () => {
  it("changes paragraph flow in one undo event and can reset every flow property", () => {
    const original = selected();
    const values = {
      lineSpacingMode: "exact",
      lineSpacing: 19.5,
      keepWithNext: false,
      keepTogether: true,
      widowOrphan: false,
      pageBreakBefore: true,
    };
    const changed = run(original, setParagraph(values));
    expect(
      parseEditorDocument(changed.doc.toJSON()).document!.firstChild!.attrs,
    ).toMatchObject(values);
    expect(selectionFormatting(changed).paragraph).toMatchObject(values);
    expect(run(changed, undo).doc.eq(original.doc)).toBe(true);
    const reset = run(
      changed,
      setParagraph(
        Object.fromEntries(paragraphProperties.map((key) => [key, null])),
      ),
    );
    for (const key of Object.keys(values))
      expect(reset.doc.firstChild!.attrs[key]).toBeNull();
    expect(reset.doc.textContent).toBe(original.doc.textContent);
  });
  it("reports printed points and heading defaults, respecting authored overrides", () => {
    expect(editorFontPoints(16)).toBe(12);
    expect(editorFontPoints()).toBe(12);
    const doc = schema.node("doc", null, [
      schema.node("heading", { level: 2 }, schema.text("Heading")),
    ]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1),
    });
    expect(selectionFormatting(state, [], { fontSize: 12 }).fontSize).toBe(
      String(headingFormatting(2).fontSize),
    );
    const direct = run(state, setParagraph({ fontSize: 17 }));
    expect(selectionFormatting(direct, [], { fontSize: 12 }).fontSize).toBe(
      "17",
    );
  });
  it("reports mixed marks/sizes and resolves inherited paragraph fonts", () => {
    const result = selectionFormatting(selected(), [
      { id: "body", name: "Body", fontFamily: "Cambria", align: "justify" },
    ]);
    expect(result).toMatchObject({
      fontFamily: "Cambria",
      fontSize: "",
      align: "justify",
      marks: { strong: "mixed", em: false },
    });
  });
  it("changes only the requested font property across mixed runs, with one undo", () => {
    const initial = selected(),
      changed = run(initial, setTextStyle({ fontFamily: "Georgia" }));
    const first = changed.doc.firstChild!.child(0),
      second = changed.doc.firstChild!.child(1);
    expect(schema.marks.text_style.isInSet(first.marks)?.attrs).toMatchObject({
      fontFamily: "Georgia",
      color: "#123456",
      fontSize: 10,
    });
    expect(schema.marks.text_style.isInSet(second.marks)?.attrs).toMatchObject({
      fontFamily: "Georgia",
      color: "#654321",
      fontSize: 16,
    });
    expect(schema.marks.link.isInSet(second.marks)?.attrs.href).toBe(
      "https://example.org",
    );
    expect(run(changed, undo).doc.eq(initial.doc)).toBe(true);
  });
  it("keeps links when clearing appearance and handles an insertion caret", () => {
    const changed = run(selected(), clearCharacterFormatting);
    expect(changed.doc.firstChild!.child(0).marks).toHaveLength(0);
    expect(
      changed.doc.firstChild!.child(1).marks.map((m) => m.type.name),
    ).toEqual(["link"]);
    let caret = changed.apply(
      changed.tr.setSelection(TextSelection.create(changed.doc, 2)),
    );
    caret = run(caret, setTextStyle({ fontSize: 13.5 }));
    expect(selectionFormatting(caret).fontSize).toBe("13.5");
  });
  it("preserves new paragraph properties through JSON and does not erase marks", () => {
    const changed = run(
      selected(),
      setParagraph({ rightIndent: 24, spaceBefore: 9, firstLineIndent: -12 }),
    );
    const reopened = parseEditorDocument(changed.doc.toJSON()).document!;
    expect(reopened.eq(changed.doc)).toBe(true);
    expect(reopened.firstChild!.attrs).toMatchObject({
      styleId: "body",
      rightIndent: 24,
      spaceBefore: 9,
      firstLineIndent: -12,
    });
    expect(reopened.firstChild!.child(0).marks).toHaveLength(2);
  });
  it("toggles a list off and preserves document text", () => {
    const initial = selected();
    const listed = run(initial, toggleList("bullet_list"));
    expect(listed.doc.firstChild!.type.name).toBe("bullet_list");
    expect(run(listed, toggleList("bullet_list")).doc.eq(initial.doc)).toBe(
      true,
    );
  });
  it("restores history with new view plugins after switching documents", () => {
    const initial = selected(),
      changed = run(initial, setTextStyle({ fontSize: 18 }));
    rememberEditorSession("commands-history", changed);
    const restored = editorSession("commands-history")!.reconfigure({
      plugins: [history()],
    });
    expect(run(restored, undo).doc.eq(initial.doc)).toBe(true);
  });
});
