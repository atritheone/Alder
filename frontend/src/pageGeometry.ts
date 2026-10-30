import format from "../../backend/alder/page-format.json";

export type PageInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};
export type PageGeometry = {
  lineNumbering?: import('./lineNumbering').LineNumbering | null;
  watermark?: import('./watermark').Watermark | null;
  pageBorder?: import("./pageBorder").PageBorder | null;
  columns?: import("./columns").Columns;
  width: number;
  height: number;
  margin: number;
  margins?: PageInsets;
  mirrorMargins?: boolean;
};
export type PageSettings = {
  lineNumbering?: import('./lineNumbering').LineNumbering | null;
  watermark?: import('./watermark').Watermark | null;
  pageBorder?: import("./pageBorder").PageBorder | null;
  columns?: import("./columns").Columns;
  pageSize?: string;
  orientation?: string;
  pageWidthMm?: number;
  pageHeightMm?: number;
  marginMm?: number;
  marginTopMm?: number;
  marginRightMm?: number;
  marginBottomMm?: number;
  marginLeftMm?: number;
  gutterMm?: number;
  mirrorMargins?: boolean;
};
const number = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;

/** Millimetres, shared by settings and all screen layout. Older uniform margins
 * stay meaningful; impossible legacy pairs shrink proportionally instead of
 * producing an empty body or an endless pagination loop. New edits reject them. */
export function pageGeometry(settings: PageSettings = {}) {
  const sizes: Record<string, number[]> = format.sizes;
  let [width, height] =
    settings.pageSize === "Custom"
      ? [
          number(
            settings.pageWidthMm,
            210,
            format.minimumDimension,
            format.maximumDimension,
          ),
          number(
            settings.pageHeightMm,
            297,
            format.minimumDimension,
            format.maximumDimension,
          ),
        ]
      : sizes[settings.pageSize || "A4"] || sizes.A4;
  if (settings.orientation === "landscape") [width, height] = [height, width];
  const margin = number(
    settings.marginMm,
    format.defaultMargin,
    0,
    format.maximumMargin,
  );
  const gutter = number(settings.gutterMm, 0, 0, format.maximumGutter);
  const margins: PageInsets = {
    top: number(settings.marginTopMm, margin, 0, format.maximumMargin),
    right: number(settings.marginRightMm, margin, 0, format.maximumMargin),
    bottom: number(settings.marginBottomMm, margin, 0, format.maximumMargin),
    left:
      number(settings.marginLeftMm, margin, 0, format.maximumMargin) + gutter,
  };
  let adjusted = false;
  for (const [first, second, extent] of [
    ["left", "right", width],
    ["top", "bottom", height],
  ] as const) {
    const total = margins[first] + margins[second];
    if (total > extent - format.minimumBody) {
      const factor = (extent - format.minimumBody) / total;
      margins[first] *= factor;
      margins[second] *= factor;
      adjusted = true;
    }
  }
  return { width, height, margin, margins, adjusted };
}

export function screenPageGeometry(settings: PageSettings): PageGeometry {
  const { width, height, margin, margins } = pageGeometry(settings);
  const px = 96 / 25.4;
  return {
    width: width * px,
    height: height * px,
    margin: margin * px,
    ...(settings.mirrorMargins ? { mirrorMargins: true } : {}),
    ...(settings.columns ? { columns: settings.columns } : {}),
    ...(settings.pageBorder !== undefined
      ? { pageBorder: settings.pageBorder }
      : {}),
    ...(settings.watermark !== undefined ? {watermark:settings.watermark} : {}),
    ...(settings.lineNumbering !== undefined ? {lineNumbering:settings.lineNumbering} : {}),
    margins: {
      top: margins.top * px,
      right: margins.right * px,
      bottom: margins.bottom * px,
      left: margins.left * px,
    },
  };
}

export function pageInsets(layout: PageGeometry): PageInsets {
  return (
    layout.margins || {
      top: layout.margin,
      right: layout.margin,
      bottom: layout.margin,
      left: layout.margin,
    }
  );
}

export function pageGeometryCSS(layout: PageGeometry): Record<string, string> {
  return Object.fromEntries(
    Object.entries(pageInsets(layout)).map(([edge, value]) => [
      `--page-margin-${edge}`,
      `${value}px`,
    ]),
  );
}
