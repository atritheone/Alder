import { describe, it, expect } from "vitest";
import { validColumns, columnMeasurement } from "./columns";
import { sectionLayout } from "./sectionLayout";
import { screenPageGeometry, pageInsets } from "./pageGeometry";
import { parseEditorDocument } from "./Editor";
import { projectText } from "./textProjection";

describe("column geometry and authored breaks", () => {
  it("uses a complete, bounded geometry without shrinking the physical sheet", () => {
    const layout = {
      ...screenPageGeometry({
        pageSize: "A5",
        marginMm: 15,
        columns: { count: 2, gapMm: 8 },
      }),
      lineHeight: 1.5,
      zoom: 1,
    };
    const measured = columnMeasurement(layout),
      edges = pageInsets(measured);
    expect(measured.width).toBe(layout.width);
    expect(measured.columnSource).toBe(layout);
    expect(measured.width - edges.left - edges.right).toBeCloseTo(
      (55 * 96) / 25.4,
    );
    expect(
      validColumns({ count: 6, gapMm: 8 }, { pageSize: "A5", marginMm: 15 }),
    ).toBe(false);
    expect(
      validColumns(
        { count: 2, gapMm: 8, separator: true },
        { pageSize: "A5", marginMm: 15 },
      ),
    ).toBe(true);
  });
  it("keeps an older section as a single column when the document default changes", () => {
    const base = {
      ...screenPageGeometry({ columns: { count: 2, gapMm: 8 } }),
      lineHeight: 1.5,
      zoom: 1,
    };
    const section = sectionLayout(columnMeasurement(base), {
      pageSize: "A5",
      marginMm: 15,
    });
    expect(section.columnSource?.columns).toBeUndefined();
    expect(
      section.width - pageInsets(section).left - pageInsets(section).right,
    ).toBeCloseTo((118 * 96) / 25.4);
  });
  it("retains column breaks without narrating them", () => {
    const doc = parseEditorDocument({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Left" }] },
        { type: "column_break" },
        { type: "paragraph", content: [{ type: "text", text: "Right" }] },
      ],
    }).document!;
    expect(doc).toBeTruthy();
    expect(doc.child(1).type.name).toBe("column_break");
    expect(projectText(doc).text).toBe("Left\n\nRight");
  });
});
