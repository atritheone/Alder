import { expect, it } from "vitest";
import { schema } from "./Editor";
import { defaultListTemplate } from "./outlineLists";
import { continueListedNote } from "./listNoteContinuation";
import { noteOutlineLabels } from "./noteOutlineLabels";
import { documentText } from "./textProjection";
import type { DocNode } from "./types";

const p = (text: string): DocNode => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const item = (...content: DocNode[]): DocNode => ({
  type: "list_item",
  content,
});
const template = defaultListTemplate();
template[1] = {
  ...template[1],
  format: "lower-alpha",
  pattern: "%1(%2)",
  start: 7,
  restart: 0,
};
const list = (content: DocNode[], attrs = {}): DocNode => ({
  type: "ordered_list",
  attrs,
  content,
});
const source: DocNode = {
  type: "doc",
  content: [
    list(
      [
        item(p("First"), list([item(p("Child one")), item(p("Child two"))])),
        item(p("Second")),
      ],
      { order: 4, listTemplate: template },
    ),
    p("Between"),
    list(
      [item(p("Third"), list([item(p("Child three"))])), item(p("Fourth"))],
      { listTemplate: template, continuePrevious: true },
    ),
  ],
};
const labels = (from: number) => {
  const tail = continueListedNote(source, from);
  return [
    ...noteOutlineLabels(
      schema.nodeFromJSON(source),
      schema.nodeFromJSON(tail.document),
      tail.paragraphOrigins,
      [...tail.hiddenParagraphs, ...tail.suppressedMarkers],
    ).values(),
  ].filter((value) => value !== null);
};
it("retains nested counter history after its parent and earlier siblings are consumed", () => {
  const from = documentText(source).indexOf("Child two");
  expect(labels(from)).toEqual(["4(h)", "5.", "6.", "6(i)", "7."]);
});
it("retains never-restart descendant and separated continuation counters", () => {
  const before = JSON.stringify(source),
    from = documentText(source).indexOf("Third");
  expect(labels(from)).toEqual(["6.", "6(i)", "7."]);
  expect(JSON.stringify(source)).toBe(before);
});
it("omits a label inside a continued item without changing following labels", () => {
  const from = documentText(source).indexOf("Child three") + 3;
  expect(labels(from)).toEqual(["7."]);
});
