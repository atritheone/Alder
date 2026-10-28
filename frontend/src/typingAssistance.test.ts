import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { schema } from "./Editor";
import { blockIdentities } from "./blockIdentities";
import {
  parseTextReplacements,
  typingAssistance,
  typingTransaction,
  undoTypingAssistance,
  type TypingPreferences,
} from "./typingAssistance";

const enabled: TypingPreferences = {
  smartQuotes: true,
  smartDashes: true,
  automaticLists: true,
  replacements: [{ from: "teh", to: "the" }],
};
function state(text: string, type = "paragraph", marks: any[] = []) {
  const doc = schema.node("doc", null, [
    schema.node(
      type,
      { blockId: "original" },
      text ? schema.text(text, marks) : undefined,
    ),
  ]);
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, text.length + 1),
    plugins: [history(), blockIdentities(), typingAssistance(() => enabled)],
  });
}
function type(initial: EditorState, text: string, options = enabled) {
  const { from, to } = initial.selection;
  const tr = typingTransaction(initial, from, to, text, options);
  expect(tr).not.toBeNull();
  return initial.apply(tr!);
}
function restore(initial: EditorState) {
  let next = initial;
  expect(
    undoTypingAssistance(initial, (tr) => {
      next = initial.apply(tr);
    }),
  ).toBe(true);
  return next;
}
describe("optional typing assistance", () => {
  it("undoes smart quotation marks immediately without undoing earlier typing", () => {
    const initial = state("");
    const opening = type(initial, '"');
    expect(opening.doc.textContent).toBe("“");
    expect(restore(opening).doc.textContent).toBe('"');
    expect(type(state("word"), '"').doc.textContent).toBe("word”");
    expect(type(state("isn"), "'").doc.textContent).toBe("isn’");
    expect(typingTransaction(state("12"), 3, 3, '"', enabled)).toBeNull();
  });
  it("makes dash and personal word substitutions reversible", () => {
    expect(type(state("word-"), "-").doc.textContent).toBe("word—");
    expect(restore(type(state("word-"), "-")).doc.textContent).toBe("word--");
    expect(type(state("Teh"), " ").doc.textContent).toBe("The ");
    expect(restore(type(state("Teh"), " ")).doc.textContent).toBe("Teh ");
    expect(type(state("TEH"), ".").doc.textContent).toBe("THE.");
    expect(
      typingTransaction(state("https://teh"), 12, 12, " ", enabled),
    ).toBeNull();
  });
  it("creates real lists, retains block identity and restores the typed marker", () => {
    for (const [marker, node, order] of [
      ["*", "bullet_list", undefined],
      ["4.", "ordered_list", 4],
      ["2)", "ordered_list", 2],
    ] as const) {
      const initial = state(marker);
      const changed = type(initial, " ");
      expect(changed.doc.firstChild!.type.name).toBe(node);
      if (order) expect(changed.doc.firstChild!.attrs.order).toBe(order);
      expect(
        changed.doc.firstChild!.firstChild!.firstChild!.attrs.blockId,
      ).toBe("original");
      const restored = restore(changed);
      expect(restored.doc.firstChild!.type.name).toBe("paragraph");
      expect(restored.doc.textContent).toBe(marker + " ");
      expect(restored.doc.firstChild!.attrs.blockId).toBe("original");
      let undone = changed;
      expect(
        undo(changed, (tr) => {
          undone = changed.apply(tr);
        }),
      ).toBe(true);
      expect(undone.doc.eq(initial.doc)).toBe(true);
    }
  });
  it("does not rewrite code, links, multi-character insertion or disabled rules", () => {
    for (const initial of [
      state("teh", "code_block"),
      state("teh", "paragraph", [schema.marks.code.create()]),
      state("teh", "paragraph", [
        schema.marks.link.create({ href: "https://example.org" }),
      ]),
    ]) {
      expect(typingTransaction(initial, 4, 4, " ", enabled)).toBeNull();
    }
    expect(typingTransaction(state("teh"), 4, 4, " and ", enabled)).toBeNull();
    expect(
      typingTransaction(state("-"), 2, 2, "-", {
        smartQuotes: false,
        smartDashes: false,
        automaticLists: false,
        replacements: [],
      }),
    ).toBeNull();
    const changed = type(state("teh"), " ");
    expect(
      undoTypingAssistance(changed.apply(changed.tr.insertText("x"))),
    ).toBe(false);
  });
  it("rejects malformed replacement storage and only accepts bounded whole words", () => {
    expect(parseTextReplacements("bad json")).toEqual([]);
    expect(
      parseTextReplacements(
        JSON.stringify([
          { from: "teh", to: "the" },
          { from: "two words", to: "x" },
          { from: "", to: "x" },
          { from: "word", to: "" },
          { from: "tab", to: "\t" },
        ]),
      ),
    ).toEqual([{ from: "teh", to: "the" }]);
  });
});
