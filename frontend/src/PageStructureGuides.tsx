import type { PageLayout } from "./pageFlow";
import { pageInsets } from "./pageGeometry";
import { mirroredPageLayout } from "./mirroredMargins";
import { storyVariant } from "./runningMatter";
import type { DocNode } from "./types";

export type StructureRegion = {
  kind: "body" | "column" | "header" | "footer";
  x: number;
  y: number;
  width: number;
  height: number;
};
const hasContent = (node?: DocNode | null): boolean =>
  !!node &&
  (!!node.text ||
    ["document_field", "image", "inline_image", "table"].includes(node.type) ||
    !!node.content?.some(hasContent));

/** Physical page coordinates, including section overrides and facing pages. */
export function pageStructureRegions(
  source: PageLayout,
  page: number,
): StructureRegion[] {
  const layout = mirroredPageLayout(source, page),
    m = pageInsets(layout);
  const width = Math.max(0, layout.width - m.left - m.right);
  const height = Math.max(0, layout.height - m.top - m.bottom);
  const regions: StructureRegion[] = [
    { kind: "body", x: m.left, y: m.top, width, height },
  ];
  const columns = layout.columns?.count || 1;
  if (columns > 1) {
    const gap = (layout.columns!.gapMm * 96) / 25.4;
    const columnWidth = Math.max(0, (width - gap * (columns - 1)) / columns);
    for (let i = 0; i < columns; i++)
      regions.push({
        kind: "column",
        x: m.left + i * (columnWidth + gap),
        y: m.top,
        width: columnWidth,
        height,
      });
  }
  const matter = layout.runningMatter;
  const variant =
    matter && storyVariant(matter, page, layout.sectionStartPage || 0);
  const header = matter
    ? hasContent(matter.header?.[variant!])
    : !!layout.header;
  const footer = matter
    ? hasContent(matter.footer?.[variant!])
    : !!layout.footer;
  const headerTop = matter
    ? ((matter.headerDistanceMm ?? 10) * 96) / 25.4
    : m.top / 4;
  const footerBottom = matter
    ? ((matter.footerDistanceMm ?? 10) * 96) / 25.4
    : m.bottom / 4;
  if (header && m.top > headerTop)
    regions.push({
      kind: "header",
      x: m.left,
      y: headerTop,
      width,
      height: m.top - headerTop,
    });
  if (footer && m.bottom > footerBottom)
    regions.push({
      kind: "footer",
      x: m.left,
      y: layout.height - m.bottom,
      width,
      height: m.bottom - footerBottom,
    });
  return regions;
}

export function PageStructureGuides({
  layout,
  page,
}: {
  layout: PageLayout;
  page: number;
}) {
  return (
    <svg
      className="page-structure-guides"
      width={layout.width}
      height={layout.height}
      aria-hidden="true"
      focusable="false"
    >
      {pageStructureRegions(layout, page).map((region, index) => (
        <rect
          key={index}
          className={`structure-region-${region.kind}`}
          x={region.x}
          y={region.y}
          width={region.width}
          height={region.height}
        />
      ))}
    </svg>
  );
}
