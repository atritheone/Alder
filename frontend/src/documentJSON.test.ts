import { it, expect } from "vitest";
import { schema } from "./Editor";
import { EditorState } from "prosemirror-state";
import { documentJSON } from "./documentJSON";
import { shareProject } from "./projectTimeline";
it("matches schema JSON and reuses unchanged immutable branches", () => {
  const paragraph = (text: string) =>
    schema.node(
      "paragraph",
      { tabStops: [{ position: 72, align: "left", leader: "dot" }] },
      schema.text(text, [schema.mark("strong")]),
    );
  const state = EditorState.create({
    doc: schema.node("doc", null, [paragraph("First"), paragraph("Second")]),
  });
  const before = documentJSON(state.doc);
  expect(before).toEqual(state.doc.toJSON());
  const next = state.apply(state.tr.insertText("x", 2));
  const after = documentJSON(next.doc);
  expect(after).toEqual(next.doc.toJSON());
  expect(after.content![1]).toBe(before.content![1]);
  expect(after.content![0]).not.toBe(before.content![0]);
  expect(before.content![0].content![0].text).toBe("First");
});
it("structural sharing never mutates cached or frozen inputs", () => {
  const before = { data: { value: 1 }, other: 0 };
  const after = Object.freeze({ data: Object.freeze({ value: 1 }), other: 1 });
  const shared = shareProject(before, after);
  expect(shared.data).toBe(before.data);
  expect(after.data).not.toBe(before.data);
  expect(shared.other).toBe(1);
});
