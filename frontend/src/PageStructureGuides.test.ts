import { expect, it } from "vitest";
import { pageStructureRegions } from "./PageStructureGuides";
import type { PageLayout } from "./pageFlow";

const layout: PageLayout = {
  width: 800,
  height: 1000,
  margin: 40,
  margins: { left: 100, right: 50, top: 60, bottom: 80 },
  lineHeight: 1.6,
  zoom: 1,
};
it("follows asymmetric mirrored margins, gutter-inclusive insets and column gaps", () => {
  const source = {
    ...layout,
    mirrorMargins: true,
    columns: { count: 2, gapMm: 10 },
  };
  const first = pageStructureRegions(source, 0),
    second = pageStructureRegions(source, 1);
  expect(first[0]).toEqual({
    kind: "body",
    x: 100,
    y: 60,
    width: 650,
    height: 860,
  });
  expect(second[0]).toEqual({
    kind: "body",
    x: 50,
    y: 60,
    width: 650,
    height: 860,
  });
  const columns = first.filter((region) => region.kind === "column");
  expect(columns).toHaveLength(2);
  expect(columns[1].x - columns[0].x - columns[0].width).toBeCloseTo(
    (10 * 96) / 25.4,
  );
  expect(columns[1].x + columns[1].width).toBeCloseTo(750);
});
it("shows only running regions with content in the actual first/even/default variant", () => {
  const source: PageLayout = {
    ...layout,
    runningMatter: {
      differentFirst: true,
      differentEven: true,
      headerDistanceMm: 10,
      header: {
        default: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Header" }] },
          ],
        },
        first: { type: "doc", content: [{ type: "paragraph" }] },
        even: null,
      },
      footer: {
        default: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "document_field", attrs: { fieldKind: "page" } },
              ],
            },
          ],
        },
      },
    },
  };
  expect(pageStructureRegions(source, 0).map((region) => region.kind)).toEqual([
    "body",
  ]);
  expect(pageStructureRegions(source, 1).map((region) => region.kind)).toEqual([
    "body",
  ]);
  const third = pageStructureRegions(source, 2);
  expect(third.map((region) => region.kind)).toEqual([
    "body",
    "header",
    "footer",
  ]);
  expect(third[1].y).toBeCloseTo((10 * 96) / 25.4);
  expect(third[1].y + third[1].height).toBe(60);
});
