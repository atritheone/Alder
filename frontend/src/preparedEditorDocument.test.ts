import { it, expect } from "vitest";
import { preparedEditorDocument, parseEditorDocument } from "./Editor";
import type { DocNode } from "./types";
it("reuses immutable parsed roots and validates new external roots through the complete parser", () => {
  const source: DocNode = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Café 😀" }] },
    ],
  };
  const first = preparedEditorDocument(source);
  expect(preparedEditorDocument(source).document).toBe(first.document);
  expect(first.document?.eq(parseEditorDocument(source).document!)).toBe(true);
  const external = structuredClone(source);
  external.content![0].content![0].text = "External replacement";
  expect(preparedEditorDocument(external).document?.textContent).toBe(
    "External replacement",
  );
  expect(
    preparedEditorDocument({ type: "unsupported_document" }).document,
  ).toBeNull();
});
