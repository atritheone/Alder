import { it, expect } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { schema, parseEditorDocument } from "./Editor";
import { setParagraph, selectionFormatting } from "./editorCommands";
import { discretionaryHyphens } from "./hyphenation";
it("changes direction without changing authored Unicode and resets it independently", () => {
  const doc = schema.nodeFromJSON({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "مرحبا English 123 😀" }],
      },
    ],
  });
  let state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, 1),
  });
  setParagraph({ textDirection: "rtl", textLanguage: "ar" })(
    state,
    (tr) => (state = state.apply(tr)),
  );
  expect(state.doc.textContent).toBe(doc.textContent);
  expect(selectionFormatting(state).paragraph.textDirection).toBe("rtl");
  setParagraph({ textDirection: null })(
    state,
    (tr) => (state = state.apply(tr)),
  );
  expect(state.doc.firstChild!.attrs.textDirection).toBe(null);
  expect(state.doc.firstChild!.attrs.textLanguage).toBe("ar");
  expect(
    parseEditorDocument({
      type: "doc",
      content: [{ type: "paragraph", attrs: { textDirection: "vertical" } }],
    }).document,
  ).toBeNull();
});
it("projects inherited direction and language as semantic node attributes", () => {
  const doc = schema.nodeFromJSON({
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { styleId: "rtl" },
        content: [{ type: "text", text: "שלום English" }],
      },
    ],
  });
  const plugin = discretionaryHyphens(
      () => ({
        styles: [
          {
            id: "rtl",
            name: "Hebrew",
            textDirection: "rtl",
            textLanguage: "he",
          },
        ],
        language: "en",
        enabled: true,
      }),
      () => {},
      () => {},
    ),
    state = EditorState.create({ doc, plugins: [plugin] });
  const decos = (plugin.props.decorations as any).call(plugin, state).find();
  expect(decos.map((d: any) => d.type.attrs)).toEqual(
    expect.arrayContaining([{ dir: "rtl" }, { lang: "he" }]),
  );
});
