import { describe, expect, it } from "vitest";
import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { projectText } from "./textProjection";
import { proofreadingTransaction } from "./proofreadingEdits";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: {},
  },
  marks: { strong: {}, link: { attrs: { href: {} } } },
});
function state(...paragraphs: string[]) {
  return EditorState.create({
    schema,
    plugins: [history()],
    doc: schema.node(
      "doc",
      null,
      paragraphs.map((text) =>
        schema.node("paragraph", null, text ? schema.text(text) : undefined),
      ),
    ),
  });
}

describe("proofreading transactions", () => {
  it("retains the actual inline citation node while revising the surrounding sentence", () => {
    const rich = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "inline*" },
        text: { group: "inline" },
        citation: {
          inline: true,
          group: "inline",
          content: "text*",
          atom: true,
          attrs: { sourceId: { default: "source-1" } },
        },
      },
    });
    const citation = rich.node("citation", { sourceId: "reference-7" }, [
      rich.text("(Smith, 2020)"),
    ]);
    const current = EditorState.create({
      schema: rich,
      doc: rich.node("doc", null, [
        rich.node("paragraph", null, [
          rich.text("The report "),
          citation,
          rich.text(" it explains the process."),
        ]),
      ]),
    });
    const source = projectText(current.doc).text;
    const replacement = "The report (Smith, 2020) explains the process.";
    const next = current.apply(
      proofreadingTransaction(
        current,
        source,
        [{ start: 0, end: source.length, originalText: source, replacement }],
        true,
      ),
    );
    expect(projectText(next.doc).text).toBe(replacement);
    expect(next.doc.firstChild!.child(1).eq(citation)).toBe(true);
    expect(() =>
      proofreadingTransaction(
        current,
        source,
        [
          {
            start: 0,
            end: source.length,
            originalText: source,
            replacement: "The report (Jones, 2020) explains the process.",
          },
        ],
        true,
      ),
    ).toThrow(/inline field/);
  });
  it("retains uniform formatting across a complete revision", () => {
    const source = "The proposal was discussed by the committee.";
    const replacement = "The committee discussed the proposal.";
    const current = EditorState.create({
      schema,
      doc: schema.node("doc", null, [
        schema.node("paragraph", null, [
          schema.text(source, [schema.marks.strong.create()]),
        ]),
      ]),
    });
    const next = current.apply(
      proofreadingTransaction(
        current,
        source,
        [{ start: 0, end: source.length, originalText: source, replacement }],
        true,
      ),
    );
    expect(next.doc.firstChild!.firstChild!.marks[0].type.name).toBe("strong");
    expect(projectText(next.doc).text).toBe(replacement);
  });
  it("retains a hyperlink within a restructured sentence", () => {
    const source =
      "The report that is available online it explains the process.";
    const replacement = "The report available online explains the process.";
    const current = EditorState.create({
      schema,
      doc: schema.node("doc", null, [
        schema.node("paragraph", null, [
          schema.text("The report that is "),
          schema.text("available online", [
            schema.marks.link.create({ href: "https://example.test/report" }),
          ]),
          schema.text(" it explains the process."),
        ]),
      ]),
    });
    const next = current.apply(
      proofreadingTransaction(
        current,
        source,
        [{ start: 0, end: source.length, originalText: source, replacement }],
        true,
      ),
    );
    const links: string[] = [];
    next.doc.descendants((node) => {
      if (node.isText && node.marks.some((mark) => mark.type.name === "link"))
        links.push(node.text!);
    });
    expect(links.join("")).toBe("available online");
  });
  it("accepts a whole-sentence rewrite retaining a moved bold phrase and one-step undo", () => {
    const source = "The report that the team wrote it needs work.";
    const replacement = "The report written by the team needs work.";
    let current = EditorState.create({
      schema,
      plugins: [history()],
      doc: schema.node("doc", null, [
        schema.node("paragraph", null, [
          schema.text("The report that "),
          schema.text("the team", [schema.marks.strong.create()]),
          schema.text(" wrote it needs work."),
        ]),
      ]),
    });
    current = current.apply(
      proofreadingTransaction(
        current,
        source,
        [{ start: 0, end: source.length, originalText: source, replacement }],
        true,
      ),
    );
    expect(projectText(current.doc).text).toBe(replacement);
    const marked: string[] = [];
    current.doc.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === "strong"))
        marked.push(node.text!);
    });
    expect(marked.join("")).toBe("the team");
    undo(current, (tr) => {
      current = current.apply(tr);
    });
    expect(projectText(current.doc).text).toBe(source);
  });
  it("applies linked edits after emoji and undoes the whole group", () => {
    const text = "😀 He go and buy apples.";
    let current = state(text);
    const edits = [
      { start: 8, end: 8, originalText: "", replacement: "es" },
      { start: 16, end: 16, originalText: "", replacement: "s" },
    ];
    current = current.apply(proofreadingTransaction(current, text, edits));
    expect(projectText(current.doc).text).toBe("😀 He goes and buys apples.");
    undo(current, (transaction) => {
      current = current.apply(transaction);
    });
    expect(projectText(current.doc).text).toBe(text);
  });
  it("supports deletion and rejects stale sources even at an insertion", () => {
    const current = state("the the cat");
    const transaction = proofreadingTransaction(current, "the the cat", [
      { start: 4, end: 8, originalText: "the ", replacement: "" },
    ]);
    expect(projectText(transaction.doc).text).toBe("the cat");
    expect(() =>
      proofreadingTransaction(current, "the cat", [
        { start: 3, end: 3, originalText: "", replacement: "." },
      ]),
    ).toThrow(/earlier text/);
  });
  it("rejects a structural edit, a split surrogate and overlapping edits", () => {
    expect(() =>
      proofreadingTransaction(state("a", "b"), "a\nb", [
        { start: 0, end: 3, originalText: "a\nb", replacement: "ab" },
      ]),
    ).toThrow(/structure/);
    expect(() =>
      proofreadingTransaction(state("😀"), "😀", [
        { start: 1, end: 1, originalText: "", replacement: "x" },
      ]),
    ).toThrow();
    expect(() =>
      proofreadingTransaction(state("abc"), "abc", [
        { start: 0, end: 2, originalText: "ab", replacement: "a" },
        { start: 1, end: 3, originalText: "bc", replacement: "c" },
      ]),
    ).toThrow(/overlapping/);
  });
  it("preserves unaffected bold and links", () => {
    const doc = schema.node(
      "doc",
      null,
      schema.node("paragraph", null, [
        schema.text("Bold", [schema.marks.strong.create()]),
        schema.text(" mispelled "),
        schema.text("link", [
          schema.marks.link.create({ href: "https://example.com" }),
        ]),
      ]),
    );
    const current = EditorState.create({ schema, doc });
    const transaction = proofreadingTransaction(
      current,
      "Bold mispelled link",
      [
        {
          start: 5,
          end: 14,
          originalText: "mispelled",
          replacement: "misspelled",
        },
      ],
    );
    expect(transaction.doc.firstChild!.firstChild!.marks[0].type.name).toBe(
      "strong",
    );
    expect(transaction.doc.firstChild!.lastChild!.marks[0].attrs.href).toBe(
      "https://example.com",
    );
  });
  it("does not flatten formatting inside a replacement", () => {
    const doc = schema.node(
      "doc",
      null,
      schema.node("paragraph", null, [
        schema.text("mis", [schema.marks.strong.create()]),
        schema.text("pelled"),
      ]),
    );
    const current = EditorState.create({ schema, doc });
    expect(() =>
      proofreadingTransaction(current, "mispelled", [
        {
          start: 0,
          end: 9,
          originalText: "mispelled",
          replacement: "misspelled",
        },
      ]),
    ).toThrow(/formatting/);
  });
  it("keeps an immediately preceding typing operation separate from a fix", () => {
    let current = state("mispelle");
    current = current.apply(current.tr.insertText("d", 9));
    current = current.apply(
      proofreadingTransaction(current, "mispelled", [
        {
          start: 0,
          end: 9,
          originalText: "mispelled",
          replacement: "misspelled",
        },
      ]),
    );
    undo(current, (tr) => {
      current = current.apply(tr);
    });
    expect(projectText(current.doc).text).toBe("mispelled");
    undo(current, (tr) => {
      current = current.apply(tr);
    });
    expect(projectText(current.doc).text).toBe("mispelle");
  });
});
