import { describe, expect, it } from "vitest";
import { Schema } from "prosemirror-model";
import {
  advanceHeading,
  chapterHeadingStarts,
  headingLabels,
} from "./headingNumbering";
import type { Project } from "./types";

const schema = new Schema({
  nodes: {
    doc: { content: "heading*" },
    text: {},
    heading: {
      content: "text*",
      attrs: {
        level: { default: 1 },
        headingNumbered: { default: null },
        headingStart: { default: null },
        styleId: { default: null },
      },
    },
  },
});
const heading = (level: number, attrs = {}) =>
  schema.nodes.heading.create(
    { level, headingNumbered: true, ...attrs },
    schema.text("Title"),
  );
describe("heading numbering", () => {
  it("restarts subordinate levels and displays Word's initial missing ancestor", () => {
    const counts = [0, 0, 0, 0, 0, 0];
    expect(
      [1, 2, 2, 1, 3].map((level) => advanceHeading(counts, level)),
    ).toEqual(["1", "1.1", "1.2", "2", "2.1.1"]);
  });
  it("recalculates on movement and respects explicit restarts and style overrides", () => {
    const first = heading(1),
      second = heading(2),
      restarted = heading(1, { headingStart: 5 });
    const styled = heading(2, { headingNumbered: null, styleId: "numbered" });
    const hidden = heading(1, { headingNumbered: false, styleId: "numbered" });
    const styles = [
      { id: "numbered", name: "Numbered", headingNumbered: true },
    ];
    expect(
      headingLabels(
        schema.nodes.doc.create(null, [
          first,
          second,
          restarted,
          hidden,
          styled,
        ]),
        styles,
      ).map((n) => n.label),
    ).toEqual(["1", "1.1", "5", "5.1"]);
    expect(
      headingLabels(
        schema.nodes.doc.create(null, [restarted, second, first]),
        styles,
      ).map((n) => n.label),
    ).toEqual(["5", "5.1", "6"]);
    expect(first.textContent).toBe("Title");
  });
  it("continues across included chapters without modifying their documents", () => {
    const document = schema.nodes.doc
      .create(null, [heading(1), heading(2)])
      .toJSON();
    const project = {
      styles: [],
      book: {
        chapters: [
          { id: "first", document },
          { id: "excluded", include: false, document },
          { id: "last", document },
        ],
      },
    } as unknown as Project;
    const before = JSON.stringify(project);
    expect(chapterHeadingStarts(project, "last")).toEqual([1, 1, 0, 0, 0, 0]);
    expect(JSON.stringify(project)).toBe(before);
  });
});
