import { describe, expect, it } from "vitest";
import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { documentUnits, moveArrangementUnit } from "./arrangementUnits";
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      attrs: { align: { default: null } },
    },
    text: { group: "inline" },
    page_break: { group: "block" },
  },
  marks: { strong: {}, em: {} },
});
const p = (text: string) =>
  schema.node("paragraph", null, text ? schema.text(text) : undefined);
const state = (...nodes: ReturnType<typeof p>[]) =>
  EditorState.create({ doc: schema.node("doc", null, nodes) });
describe("arrangement units", () => {
  const wrapped = [
    "Alice was beginning to get very tired of sitting by her sister",
    "on the bank, and of having nothing to do: once or twice she had",
    "peeped into the book her sister was reading, but it had no",
    "pictures or conversations in it, 'and what is the use of a book,'",
    "thought Alice 'without pictures or conversation?'",
  ];
  it("groups legacy hard-wrapped prose across source lines without changing the document", () => {
    const original = state(
      ...wrapped.map(p),
      p(""),
      p("In another moment down went Alice after it, never once"),
      p("considering how in the world she was to get out again."),
    );
    const before = original.doc.toJSON();
    const paragraphs = documentUnits(original.doc).filter(
      (u) => u.kind === "paragraph" && u.text,
    );
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].text).toBe(wrapped.join(" "));
    expect(
      documentUnits(original.doc).filter((u) => u.kind === "sentence"),
    ).toHaveLength(2);
    const moved = moveArrangementUnit(
      original,
      paragraphs[0],
      original.doc.content.size,
    )!;
    expect(moved.tr.doc.lastChild!.textContent).toBe(wrapped.join(" "));
    expect(
      documentUnits(moved.tr.doc).some(
        (u) => u.kind === "paragraph" && u.text === wrapped.join(" "),
      ),
    ).toBe(true);
    expect(original.doc.toJSON()).toEqual(before);
  });
  it("moves a sentence spanning legacy line blocks as inline text, preserving marks", () => {
    const original = state(
      ...wrapped.map((line) =>
        schema.node("paragraph", null, schema.text(line, [schema.mark("em")])),
      ),
      p(""),
      p("Destination."),
    );
    const sentences = documentUnits(original.doc).filter(
      (u) => u.kind === "sentence",
    );
    const moved = moveArrangementUnit(
      original,
      sentences[0],
      sentences.at(-1)!.to,
    )!;
    expect(moved.tr.doc.lastChild!.textContent).toBe(
      "Destination. " + wrapped.join(" "),
    );
    expect(moved.tr.doc.lastChild!.lastChild!.marks[0].type.name).toBe("em");
    moved.tr.doc.check();
  });
  it("recognises a two-line wrapped paragraph independently of other paragraphs", () => {
    const original = state(
      p("In another moment down went Alice after it, never once"),
      p("considering how in the world she was to get out again."),
    );
    expect(
      documentUnits(original.doc).filter((u) => u.kind === "paragraph"),
    ).toHaveLength(1);
    expect(
      documentUnits(original.doc).filter((u) => u.kind === "sentence"),
    ).toHaveLength(1);
  });
  it("keeps authored paragraphs, headings and short verse separate", () => {
    const original = state(
      p("A complete paragraph with enough words to exceed forty characters."),
      p(
        "Another complete paragraph with enough words to exceed forty characters.",
      ),
      p(
        "A third complete paragraph with enough words to exceed forty characters.",
      ),
      p(""),
      p("short verse"),
      p("second line"),
      p("third line"),
    );
    expect(
      documentUnits(original.doc).filter((u) => u.kind === "paragraph"),
    ).toHaveLength(7);
  });
  it("moves a whole paragraph with its formatting across a page break in one transaction", () => {
    const first = schema.node(
      "paragraph",
      { align: "right" },
      schema.text("First paragraph.", [schema.mark("strong")]),
    );
    const original = state(
      first,
      schema.node("page_break"),
      p("Last paragraph."),
    );
    const unit = documentUnits(original.doc)[0];
    const moved = moveArrangementUnit(
      original,
      unit,
      original.doc.content.size,
    )!;
    expect(moved.tr.doc.lastChild!.eq(first)).toBe(true);
    expect(original.doc.firstChild!.eq(first)).toBe(true);
    expect(moved.tr.doc.child(0).type.name).toBe("page_break");
  });
  it("moves marked sentences between paragraphs, preserving words, punctuation and emoji", () => {
    const original = state(
      schema.node("paragraph", null, [
        schema.text("One 😀. ", [schema.mark("em")]),
        schema.text("Two! Three?"),
      ]),
      p("Other."),
    );
    const units = documentUnits(original.doc).filter(
      (u) => u.kind === "sentence",
    );
    const moved = moveArrangementUnit(original, units[0], units.at(-1)!.to)!;
    expect(moved.tr.doc.firstChild!.textContent).toBe("Two! Three?");
    expect(moved.tr.doc.lastChild!.textContent).toBe("Other. One 😀.");
    expect(moved.tr.doc.lastChild!.lastChild!.marks[0].type.name).toBe("em");
  });
  it("reorders sentences inside one paragraph and supports an empty destination", () => {
    const original = state(p("First. Second. Third."), p(""));
    const units = documentUnits(original.doc).filter(
      (u) => u.kind === "sentence",
    );
    expect(
      moveArrangementUnit(original, units[2], units[0].from)!.tr.doc.firstChild!
        .textContent,
    ).toBe("Third. First. Second.");
    const empty = documentUnits(original.doc).find(
      (u) => u.kind === "paragraph" && !u.text,
    )!;
    expect(
      moveArrangementUnit(original, units[1], empty.from + 1)!.tr.doc.lastChild!
        .textContent,
    ).toBe("Second.");
    expect(moveArrangementUnit(original, units[0], units[0].to)).toBeNull();
  });
  it("rejects stale ranges instead of moving unrelated text", () => {
    const original = state(p("First. Second."));
    const unit = documentUnits(original.doc)[0];
    expect(() => moveArrangementUnit(state(p("Changed.")), unit, 0)).toThrow(
      "document changed",
    );
  });
});
