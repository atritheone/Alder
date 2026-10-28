import { describe, expect, it } from "vitest";
import { EditorState } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { schema } from "./Editor";
import { findText, replaceMatches } from "./findText";

describe("find and replace", () => {
  it("searches literal punctuation, case and Unicode whole words", () => {
    const options = { caseSensitive: false, wholeWord: true };
    expect(findText("Cat cat concatenate cat.", "cat", options)).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 20, end: 23 },
    ]);
    expect(
      findText("a.b a+b aXb", "a.b", { ...options, wholeWord: false }),
    ).toEqual([{ start: 0, end: 3 }]);
    expect(findText("école écoles", "école", options)).toHaveLength(1);
    expect(
      findText("CAT Cat cat", "cat", { ...options, caseSensitive: true }),
    ).toEqual([{ start: 8, end: 11 }]);
  });
  it("bounds matches to a selection", () => {
    expect(
      findText("one one one", "one", {
        caseSensitive: false,
        wholeWord: false,
        start: 4,
        end: 7,
      }),
    ).toEqual([{ start: 4, end: 7 }]);
  });
  it("replaces all in one undo step and rejects an obsolete search", () => {
    const doc = schema.node("doc", null, [
      schema.node(
        "paragraph",
        null,
        schema.text("cat and cat", [schema.marks.em.create()]),
      ),
    ]);
    let state = EditorState.create({ doc, plugins: [history()] });
    const matches = findText("cat and cat", "cat", {
      caseSensitive: false,
      wholeWord: false,
    });
    state = state.apply(replaceMatches(state, matches, "tiger", "cat and cat"));
    expect(state.doc.textContent).toBe("tiger and tiger");
    expect(
      schema.marks.em.isInSet(state.doc.firstChild!.firstChild!.marks),
    ).toBeTruthy();
    expect(() => replaceMatches(state, matches, "dog", "cat and cat")).toThrow(
      "document changed",
    );
    undo(state, (tr) => {
      state = state.apply(tr);
    });
    expect(state.doc.eq(doc)).toBe(true);
  });
});
