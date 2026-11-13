// @vitest-environment jsdom
import { it, expect, beforeEach, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { EditorState, EditorSelection } from "@codemirror/state";
import { bookmarkField, markField } from "./plainTextMarks";
import { persistTextMetadata, readTextMetadata } from "./plainTextMetadata";
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
});
const state = (doc = "one two three") =>
  EditorState.create({
    doc,
    extensions: [
      bookmarkField,
      markField,
      EditorState.allowMultipleSelections.of(true),
    ],
    selection: EditorSelection.create(
      [EditorSelection.range(3, 0), EditorSelection.range(8, 13)],
      1,
    ),
  });
it("remembers all selections and their direction even without bookmarks", async () => {
  await persistTextMetadata("p:write", state());
  const restored = await readTextMetadata("p:write", state());
  expect(restored?.selection.toJSON()).toEqual(state().selection.toJSON());
});
it("does not apply positions to changed text or malformed stored selections", async () => {
  await persistTextMetadata("p:write", state());
  expect(await readTextMetadata("p:write", state("different text"))).toBeNull();
  const saved = JSON.parse(localStorage.getItem("alder.txt.metadata.p:write")!);
  saved.selection = { ranges: [{ anchor: -5, head: 99999 }], main: 0 };
  localStorage.setItem("alder.txt.metadata.p:write", JSON.stringify(saved));
  expect(await readTextMetadata("p:write", state())).toBeNull();
});
