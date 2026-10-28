import { describe, expect, it } from "vitest";
import { EditorState } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { schema } from "./Editor";
import { searchPatterns } from "./patternSearch";
import { replaceMatches } from "./findText";
const search = (text: string, query: string, replacement = "", options = {}) =>
  searchPatterns({
    sources: [{ id: "one", title: "One", text }],
    query,
    replacement,
    options: { caseSensitive: false, wholeWord: false, ...options },
  });
describe("pattern search", () => {
  it("expands numbered/named groups and literal dollars with Unicode offsets", () => {
    const result = search(
      "😀 Item 12, Item 34",
      "(?<label>Item) (\\d+)",
      "$<label>:$2 $$ $&",
    );
    expect(result.error).toBeUndefined();
    expect(result.matches).toEqual([
      { start: 3, end: 10, replacement: "Item:12 $ Item 12", sourceId: "one" },
      { start: 12, end: 19, replacement: "Item:34 $ Item 34", sourceId: "one" },
    ]);
    expect(result.matches[0]).not.toHaveProperty("sourceText");
  });
  it("honours case, whole words and original selection bounds", () => {
    const result = search("a CAT cats cat", "cat", "dog", {
      wholeWord: true,
      caseSensitive: true,
      start: 4,
    });
    expect(result.matches.map((match) => match.start)).toEqual([11]);
    expect(
      search("école écoles", "écol.", "", { wholeWord: true }).matches,
    ).toHaveLength(1);
    expect(
      search("😀abc", "abc", "", { start: 2, end: 5 }).matches[0].start,
    ).toBe(2);
  });
  it("reports malformed and empty-position expressions without offering unsafe replacements", () => {
    expect(search("one", "[").error).toContain("Invalid pattern");
    expect(search("one", "^", "start").matches).toEqual([]);
    expect(search("one", "o*", "many").error).toContain("empty positions");
    expect(search("one", "").matches).toEqual([]);
  });
  it("replaces different captures in one undo while retaining formatting and stale-result checks", () => {
    const text = "A12 B34";
    const doc = schema.node(
      "doc",
      null,
      schema.node("paragraph", null, schema.text(text, [schema.mark("em")])),
    );
    const original = EditorState.create({ doc, plugins: [history()] });
    const result = search(text, "([A-Z])(\\d+)", "$2-$1");
    let state = original.apply(
      replaceMatches(original, result.matches, "unused", text),
    );
    expect(state.doc.textContent).toBe("12-A 34-B");
    expect(state.doc.firstChild!.firstChild!.marks[0].type.name).toBe("em");
    expect(() => replaceMatches(state, result.matches, "", text)).toThrow(
      "document changed",
    );
    undo(state, (tr) => {
      state = state.apply(tr);
    });
    expect(state.doc.eq(doc)).toBe(true);
  });
});
