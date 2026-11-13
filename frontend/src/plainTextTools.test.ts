import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { documentWords, completeDocumentWord } from "./plainTextCompletion";
import { isPlainDocument, transformText } from "./plainTextTools";

describe("TXT tools", () => {
  it("retains final newlines and distinguishes empty and blank lines", () => {
    expect(transformText("b\n\n \na\n", "remove-empty")).toBe("b\n \na\n");
    expect(transformText("b\n\n \na\n", "remove-blank")).toBe("b\na\n");
    expect(transformText("b\na", "sort")).toBe("a\nb");
    expect(transformText("b\na\n", "sort")).toBe("a\nb\n");
  });
  it("uses visual tab stops and preserves nonleading spaces on reverse conversion", () => {
    expect(transformText("ab\tc\t", "tabs-spaces", 4)).toBe("ab  c   ");
    expect(transformText("    ab  c", "spaces-tabs", 4)).toBe("\tab  c");
  });
  it("protects legacy rich content", () => {
    expect(
      isPlainDocument({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "a" }] },
        ],
      }),
    ).toBe(true);
    expect(
      isPlainDocument({ type: "text", text: "a", marks: [{ type: "strong" }] }),
    ).toBe(false);
    expect(
      isPlainDocument({ type: "paragraph", attrs: { align: "center" } }),
    ).toBe(false);
  });
});
describe("whole document completion index", () => {
  it("offers words beyond the library default scan radius", async () => {
    const state = EditorState.create({
      doc: "aur\n" + "other\n".repeat(20000) + "aurora",
      extensions: [documentWords],
    });
    const result = await completeDocumentWord(
      new CompletionContext(state, 3, false),
    );
    expect(result?.options.map((o) => o.label)).toContain("aurora");
  });
  it("removes obsolete words and handles adjacent changes without double counting", () => {
    let state = EditorState.create({
      doc: "alpha\nbeta\nalpha\nend",
      extensions: [documentWords],
    });
    state = state.update({
      changes: [
        { from: 0, to: 5, insert: "gamma" },
        { from: 6, to: 10, insert: "delta" },
      ],
    }).state;
    expect([...state.field(documentWords)]).toEqual(
      expect.arrayContaining([
        ["alpha", 1],
        ["gamma", 1],
        ["delta", 1],
        ["end", 1],
      ]),
    );
    expect(state.field(documentWords).has("beta")).toBe(false);
    state = state.update({
      changes: { from: 0, to: state.doc.length, insert: "" },
    }).state;
    expect(state.field(documentWords).size).toBe(0);
  });
});
