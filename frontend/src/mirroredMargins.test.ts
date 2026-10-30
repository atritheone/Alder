import { describe, expect, it } from "vitest";
import { schema } from "./Editor";
import { mirroredPageLayout, mirroredPlacement } from "./mirroredMargins";
import { sectionLayout } from "./sectionLayout";
import type { FlowPage } from "./pageFlow";

const layout = {
  width: 500,
  height: 420,
  margin: 40,
  margins: { left: 120, right: 40, top: 40, bottom: 40 },
  zoom: 1,
  lineHeight: 1.5,
  mirrorMargins: true,
};
describe("mirrored editable page placement", () => {
  it("uses logical page parity and retains mirror behaviour in sections", () => {
    expect(mirroredPageLayout(layout, 0).margins?.left).toBe(120);
    expect(mirroredPageLayout(layout, 1).margins?.left).toBe(40);
    expect(
      mirroredPageLayout({ ...layout, firstPageNumber: 2 }, 0).margins?.left,
    ).toBe(40);
    expect(
      mirroredPageLayout({ ...layout, pageNumberOffset: -1 }, 3).margins?.left,
    ).toBe(40);
    expect(sectionLayout(layout, { pageSize: "A5" }).mirrorMargins).toBe(true);
  });
  it("moves only the page-owned part without changing source text or history", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, schema.text("FirstSecondThird")),
    ]);
    const pages: FlowPage[] = [
      { from: 0, to: 6, text: "First" },
      { from: 6, to: 12, text: "Second" },
      { from: 12, to: doc.content.size, text: "Third" },
    ];
    const decorations = mirroredPlacement(doc, layout, pages);
    expect(
      decorations.find().map(({ from, to }) => doc.textBetween(from, to)),
    ).toEqual(["Second"]);
    expect(doc.textContent).toBe("FirstSecondThird");
    expect(mirroredPlacement(doc, layout, pages)).toBe(decorations);
    expect(
      mirroredPlacement(doc, { ...layout, mirrorMargins: false }, pages).find(),
    ).toHaveLength(0);
  });
  it("visits a spanning cell even when the last cell ends on the first page", () => {
    const p = (text: string) =>
      schema.node("paragraph", null, schema.text(text));
    const doc = schema.node("doc", null, [
      schema.node("table", null, [
        schema.node("table_row", null, [
          schema.node("table_cell", null, [p("FirstSecondThird")]),
          schema.node("table_cell", null, [p("Short")]),
        ]),
      ]),
    ]);
    let long = 0,
      short = 0;
    doc.descendants((node, pos) => {
      if (node.isTextblock) {
        if (node.textContent === "Short") short = pos + 1;
        else long = pos + 1;
      }
    });
    const pages: FlowPage[] = [
      {
        from: 0,
        to: doc.content.size,
        text: "First Short",
        fragments: [
          { from: 0, to: long + 5 },
          { from: short - 1, to: doc.content.size },
        ],
      },
      {
        from: long + 5,
        to: long + 11,
        text: "Second",
        fragments: [{ from: long + 5, to: long + 11 }],
      },
      {
        from: long + 11,
        to: short - 1,
        text: "Third",
        fragments: [{ from: long + 11, to: short - 1 }],
      },
    ];
    const decorations = mirroredPlacement(doc, layout, pages);
    expect(
      decorations.find().map(({ from, to }) => doc.textBetween(from, to)),
    ).toEqual(["Second"]);
  });
});
