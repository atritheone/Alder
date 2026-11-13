import { it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { columnChanges, columnInsertion } from "./plainTextColumns";
it("pads short lines and splits a tab only when inserting inside it", () => {
  expect(columnInsertion("x", 3, "N", 4)).toEqual({
    from: 1,
    to: 1,
    insert: "  N",
  });
  expect(columnInsertion("\tX", 2, "N", 4)).toEqual({
    from: 0,
    to: 1,
    insert: "  N  ",
  });
  expect(columnInsertion("😀e\u0301x", 2, "N", 4)).toEqual({
    from: 4,
    to: 4,
    insert: "N",
  });
});
it("excludes the unselected line at a selection end and creates a single edit group", () => {
  const state = EditorState.create({
    doc: "a\nb\nc",
    selection: { anchor: 0, head: 4 },
  });
  const result = state.update({
    changes: columnChanges(state, 0, (i) => `${i + 1}. `),
  }).state;
  expect(result.doc.toString()).toBe("1. a\n2. b\nc");
});
