import { it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import {
  bookmarkField,
  toggleBookmark,
  markField,
  markSelection,
} from "./plainTextMarks";

it("moves bookmarks with their lines, toggles them, and maps marked ranges", () => {
  let state = EditorState.create({
    doc: "first\nsecond",
    extensions: [bookmarkField, markField],
  });
  state = state.update({
    effects: [
      toggleBookmark.of(6),
      markSelection.of({ from: 6, to: 12, color: 2 }),
    ],
  }).state;
  state = state.update({ changes: { from: 0, insert: "new\n" } }).state;
  expect(state.field(bookmarkField)).toEqual([10]);
  expect(state.toJSON({ marks: markField }).marks).toEqual([
    { from: 10, to: 16, color: 2 },
  ]);
  state = state.update({ effects: toggleBookmark.of(12) }).state;
  expect(state.field(bookmarkField)).toEqual([]);
});
it("restores only valid metadata without inserting text", () => {
  const state = EditorState.fromJSON(
    {
      ...EditorState.create({ doc: "one\ntwo" }).toJSON(),
      bookmarks: [4, 4, -1, 99],
      marks: [
        { from: 0, to: 3, color: 0 },
        { from: -1, to: 100, color: 5 },
      ],
    },
    { extensions: [bookmarkField, markField] },
    { bookmarks: bookmarkField, marks: markField },
  );
  expect(state.field(bookmarkField)).toEqual([4]);
  expect(state.doc.toString()).toBe("one\ntwo");
  expect(state.toJSON({ marks: markField }).marks).toHaveLength(1);
});
