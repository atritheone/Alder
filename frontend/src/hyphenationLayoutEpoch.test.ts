import { expect, it } from "vitest";
import { Schema } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import {
  restoreHyphenationLayoutChange,
  hyphenationLayoutChange,
  clearHyphenationLayoutChange,
} from "./hyphenation";
it("preserves a stale epoch when cancelled measurements span different documents", () => {
  const schema = new Schema({ nodes: { doc: { content: "text*" }, text: {} } }),
    old = schema.node("doc", null, schema.text("old")),
    current = schema.node("doc", null, schema.text("current"));
  const view = { isDestroyed: false, state: { doc: current } } as EditorView;
  restoreHyphenationLayoutChange(view, { doc: current, from: 3, to: 6 });
  restoreHyphenationLayoutChange(view, { doc: old, from: 0, to: 2 });
  expect(hyphenationLayoutChange(view)).toEqual({ doc: old, from: 0, to: 6 });
  clearHyphenationLayoutChange(view);
  expect(hyphenationLayoutChange(view)).toBeUndefined();
});
