import type { PageSettings } from "./pageGeometry";
import { pageGeometry } from "./pageGeometry";
import type { PageLayout } from "./pageFlow";
import type { FlowPage } from "./pageFlow";
import { pageInsets } from "./pageGeometry";
export type Columns = { count: number; gapMm: number; separator?: boolean };
export function columnRulesHTML(page: FlowPage) {
  return (page.columnRules || [])
    .map(
      (rule) =>
        `<div aria-hidden="true" style="position:absolute;pointer-events:none;left:${rule.x}px;top:${rule.top}px;height:${Math.max(0, rule.bottom - rule.top)}px;border-left:0.666667px solid #888"></div>`,
    )
    .join("");
}
export function columnMeasurement(layout: PageLayout): PageLayout {
  const c = layout.columns || { count: 1, gapMm: 8 },
    m = pageInsets(layout);
  const width =
    (layout.width -
      m.left -
      m.right -
      ((c.gapMm * 96) / 25.4) * (c.count - 1)) /
    c.count;
  return {
    ...layout,
    columnSource: layout,
    mirrorMargins: false,
    margins: { ...m, right: layout.width - m.left - width },
  };
}
export function validColumns(
  value: unknown,
  page?: PageSettings,
): value is Columns {
  if (value == null) return true;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  const c = value as Columns;
  if (
    Object.keys(c).some(
      (key) => !["count", "gapMm", "separator"].includes(key),
    ) ||
    !Number.isInteger(c.count) ||
    c.count < 1 ||
    c.count > 12 ||
    typeof c.gapMm !== "number" ||
    !Number.isFinite(c.gapMm) ||
    c.gapMm < 0 ||
    c.gapMm > 100 ||
    (c.separator != null && typeof c.separator !== "boolean")
  )
    return false;
  if (page) {
    const g = pageGeometry(page);
    if (
      (g.width - g.margins.left - g.margins.right - c.gapMm * (c.count - 1)) /
        c.count <
      20
    )
      return false;
  }
  return true;
}
