import { expect, it } from "vitest";
import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { projectText } from "./textProjection";
import { proofreadingTransaction } from "./proofreadingEdits";

it("preserves actual fields, moved emphasis/links and single-step undo in 100 controlled documents", () => {
  const fieldSpec = {
    inline: true,
    group: "inline",
    content: "text*",
    atom: true,
    attrs: { sourceId: { default: "" }, kind: { default: "text" } },
  };
  const schema = new Schema({
    nodes: {
      doc: { content: "paragraph+" },
      paragraph: { content: "inline*" },
      text: { group: "inline" },
      citation: fieldSpec,
      form_field: fieldSpec,
    },
    marks: { strong: {}, link: { attrs: { href: {} } } },
  });
  for (let index = 0; index < 100; index++) {
    const label = `(Record ${index + 1})`;
    const name = ["Alice", "Beth", "Clara", "Diana"][index % 4];
    const prefix = index % 2 ? "😀 " : "";
    const field = schema.node(
      index < 50 ? "citation" : "form_field",
      { sourceId: `source-${index}`, kind: "text" },
      [schema.text(label)],
    );
    const current = EditorState.create({
      schema,
      plugins: [history()],
      doc: schema.node("doc", null, [
        schema.node("paragraph", null, [
          schema.text(`${prefix}The report `),
          field,
          schema.text(" that "),
          schema.text(name, [
            schema.mark("strong"),
            schema.mark("link", { href: `#person-${index}` }),
          ]),
          schema.text(" wrote it contain mispelled words."),
        ]),
      ]),
    });
    const source = projectText(current.doc).text;
    const replacement = `${prefix}${name} wrote the report ${label}, which contains misspelled words.`;
    const apply = (text: string) =>
      proofreadingTransaction(
        current,
        source,
        [
          {
            start: 0,
            end: source.length,
            originalText: source,
            replacement: text,
          },
        ],
        true,
      );
    let revised = current.apply(apply(replacement));
    expect(projectText(revised.doc).text).toBe(replacement);
    let fields = 0,
      formattedNames = 0;
    revised.doc.descendants((node) => {
      if (node.type.name === field.type.name) {
        expect(node.eq(field)).toBe(true);
        fields++;
      }
      if (node.isText && node.text === name) {
        expect(node.marks.map((mark) => mark.type.name)).toEqual([
          "strong",
          "link",
        ]);
        expect(
          node.marks.find((mark) => mark.type.name === "link")?.attrs.href,
        ).toBe(`#person-${index}`);
        formattedNames++;
      }
    });
    expect(fields).toBe(1);
    expect(formattedNames).toBe(1);
    expect(() =>
      apply(replacement.replace(label, `(Record ${index + 2})`)),
    ).toThrow(/inline field/);
    expect(
      undo(revised, (transaction) => {
        revised = revised.apply(transaction);
      }),
    ).toBe(true);
    expect(revised.doc.eq(current.doc)).toBe(true);
  }
});
