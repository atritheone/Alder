import type { Node as PMNode, NodeSpec } from "prosemirror-model";
import {
  pageGeometry,
  pageInsets,
  screenPageGeometry,
  type PageSettings,
} from "./pageGeometry";
import type { PageLayout, FlowPage } from "./pageFlow";
import { validNumberFormat, type PageNumberFormat } from "./pageNumbering";
import { validRunningMatter, type RunningMatter } from "./runningMatter";
import { validColumns, columnMeasurement } from "./columns";
import { validPageBorder } from "./pageBorder";
import { validWatermark } from "./watermark";
import { validLineNumbering } from "./lineNumbering";
import { validNoteOptions, type NoteOptions } from "./noteOptions";

export type SectionSettings = {
  kind: "nextPage" | "continuous" | "oddPage" | "evenPage";
  page: PageSettings;
  numberingStart?: number | null;
  numberingFormat?: PageNumberFormat | null;
  runningMatter?: RunningMatter | null;
  noteOptions?: NoteOptions | null;
};
export const sectionBreakSpec: NodeSpec = {
  atom: true,
  attrs: {
    blockId: { default: null },
    kind: { default: "nextPage" },
    page: { default: {} },
    numberingStart: { default: null },
    numberingFormat: { default: null },
    runningMatter: { default: null },
    noteOptions: { default: null },
  },
  toDOM: (node) => [
    "div",
    {
      class: "section-break page-break",
      "data-section": JSON.stringify({
        kind: node.attrs.kind,
        page: node.attrs.page,
        numberingStart: node.attrs.numberingStart,
        numberingFormat: node.attrs.numberingFormat,
        runningMatter: node.attrs.runningMatter,
        noteOptions: node.attrs.noteOptions,
      }),
      "aria-label": "Section break",
    },
    "Section break",
  ],
  parseDOM: [
    {
      tag: "div[data-section]",
      getAttrs: (element) => {
        try {
          const value = JSON.parse(
            element.getAttribute("data-section") || "{}",
          );
          return validSection(value) ? value : false;
        } catch {
          return false;
        }
      },
    },
  ],
};
export function validSection(value: unknown): value is SectionSettings {
  if (!value || typeof value !== "object") return false;
  const v = value as SectionSettings;
  if (!validRunningMatter(v.runningMatter, true)) return false;
  if (!validNoteOptions(v.noteOptions)) return false;
  if (
    v.numberingStart != null &&
    (!Number.isInteger(v.numberingStart) ||
      v.numberingStart < 1 ||
      v.numberingStart > 9999)
  )
    return false;
  if (v.numberingFormat != null && !validNumberFormat(v.numberingFormat))
    return false;
  if (
    !["nextPage", "continuous", "oddPage", "evenPage"].includes(v.kind) ||
    !v.page ||
    typeof v.page !== "object" ||
    Array.isArray(v.page)
  )
    return false;
  if (pageGeometry(v.page).adjusted) return false;
  return Object.entries(v.page).every(([key, value]) =>
    key === "lineNumbering"
      ? validLineNumbering(value)
      : key === "watermark"
        ? validWatermark(value)
        : key === "pageBorder"
          ? validPageBorder(value)
          : key === "columns"
            ? validColumns(value, v.page)
            : key === "pageSize"
              ? ["A4", "A5", "Letter", "Legal", "6x9", "Custom"].includes(
                  String(value),
                )
              : key === "orientation"
                ? ["portrait", "landscape"].includes(String(value))
                : /^(pageWidthMm|pageHeightMm|marginMm|marginTopMm|marginRightMm|marginBottomMm|marginLeftMm|gutterMm)$/.test(
                    key,
                  ) &&
                  typeof value === "number" &&
                  Number.isFinite(value) &&
                  (key.startsWith("page")
                    ? value >= 50 && value <= 1000
                    : value >= 0 && value <= (key === "gutterMm" ? 50 : 100)),
  );
}
export function settingsForLayout(layout: PageLayout): PageSettings {
  const mm = (value: number) => Number(((value * 25.4) / 96).toPrecision(12)),
    margins = pageInsets(layout);
  return {
    pageSize: "Custom",
    orientation: "portrait",
    pageWidthMm: mm(layout.width),
    pageHeightMm: mm(layout.height),
    marginTopMm: mm(margins.top),
    marginRightMm: mm(margins.right),
    marginBottomMm: mm(margins.bottom),
    marginLeftMm: mm(margins.left),
    ...(layout.columns ? { columns: layout.columns } : {}),
    ...(layout.pageBorder !== undefined
      ? { pageBorder: layout.pageBorder }
      : {}),
    ...(layout.watermark !== undefined ? { watermark: layout.watermark } : {}),
    ...(layout.lineNumbering !== undefined
      ? { lineNumbering: layout.lineNumbering }
      : {}),
  };
}
export function sectionLayout(
  base: PageLayout,
  page: PageSettings,
): PageLayout {
  if (base.columnSource)
    return columnMeasurement(sectionLayout(base.columnSource, page));
  return {
    ...base,
    ...screenPageGeometry(page),
    columns: page.columns,
    pageBorder: page.pageBorder,
    watermark: page.watermark,
    lineNumbering: page.lineNumbering,
  };
}
export function documentCanvasWidth(
  doc: PMNode | undefined,
  base: PageLayout,
): number {
  let width = base.width;
  doc?.forEach((node) => {
    if (node.type.name === "section_break")
      width = Math.max(width, sectionLayout(base, node.attrs.page).width);
  });
  return width;
}
export function pageFrame(pages: FlowPage[], index: number, base: PageLayout) {
  return (
    pages[index]?.frame || {
      top: index * (base.height + 28),
      left: 0,
      layout: base,
    }
  );
}
export function pageCanvasHeight(pages: FlowPage[], base: PageLayout) {
  const frame = pageFrame(pages, Math.max(0, pages.length - 1), base);
  return frame.top + frame.layout.height;
}
export function pageAtY(pages: FlowPage[], y: number, base: PageLayout) {
  let lo = 0,
    hi = Math.max(0, pages.length - 1);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (pageFrame(pages, mid, base).top <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
