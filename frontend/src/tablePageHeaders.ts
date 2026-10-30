import type { EditorView } from "prosemirror-view";
import type { PageLayout } from "./pageFlow";
import { pageInsets } from "./pageGeometry";
import { freezeTableLayout } from "./tableSnapshotLayout";
import { mirrorShiftToPage } from "./mirroredMargins";
import { originalPaintProperty } from "./paragraphPaint";

export type FlowHeader = {
  table: number;
  rows: number;
  height: number;
  offset?: number;
};
export const tableHeaderHeight = (headers: readonly FlowHeader[] | undefined) =>
  Math.max(
    0,
    ...(headers || []).map((header) => (header.offset || 0) + header.height),
  );

/** Repeated headers are paint-only copies. They never become authored text,
 * selections, narration, spelling results, or undo steps. */
export function tableHeaderHTML(
  view: EditorView,
  layout: PageLayout,
  header: FlowHeader | readonly FlowHeader[],
  page = 0,
): string {
  if (Array.isArray(header))
    return header
      .map((item) => tableHeaderHTML(view, layout, item, page))
      .join("");
  header = header as FlowHeader;
  const node = view.nodeDOM(header.table) as HTMLElement | null;
  const table = node?.matches("table")
    ? (node as HTMLTableElement)
    : node?.querySelector("table");
  const canvas = view.dom.closest<HTMLElement>(".flow-canvas");
  if (!table || !canvas) return "";
  const origin = canvas.getBoundingClientRect();
  const canvasWidth = parseFloat(canvas.style.width) || layout.width;
  const scale = origin.width / canvasWidth;
  const rect = table.getBoundingClientRect();
  const copy = table.cloneNode(false) as HTMLTableElement;
  const columns = table.querySelector(":scope > colgroup");
  if (columns) copy.append(columns.cloneNode(true));
  const body = document.createElement("tbody");
  // Avoid the paginator's spacer rows and rows from a nested table.
  const sourceRows = [...table.rows]
    .filter((row) => !row.classList.contains("pagination-spacer"))
    .slice(0, header.rows);
  const properties = [
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "font-variant",
    "line-height",
    "letter-spacing",
    "word-spacing",
    "text-align",
    "text-indent",
    "text-decoration",
    "vertical-align",
    "white-space",
    "overflow-wrap",
    "word-break",
    "direction",
    "color",
    "background-color",
    "box-sizing",
    "border-collapse",
    "border-spacing",
    "table-layout",
    ...["top", "right", "bottom", "left"].flatMap((edge) => [
      `margin-${edge}`,
      `padding-${edge}`,
      `border-${edge}-width`,
      `border-${edge}-style`,
      `border-${edge}-color`,
    ]),
  ];
  function appearance(original: HTMLElement, target: HTMLElement) {
    const style = getComputedStyle(original);
    for (const property of properties)
      target.style.setProperty(
        property,
        originalPaintProperty(original, property) ??
          style.getPropertyValue(property),
      );
    for (const attribute of [...target.attributes])
      if (
        attribute.name.startsWith("on") ||
        ["id", "contenteditable", "tabindex", "data-block-id"].includes(
          attribute.name,
        )
      )
        target.removeAttribute(attribute.name);
    target.classList.remove(
      "selectedCell",
      "ProseMirror-selectednode",
      "reading-word",
      "annotation",
      "annotation-repetition",
    );
    if (original.classList.contains("reading-word"))
      target.style.backgroundColor = "transparent";
  }
  appearance(table, copy);
  for (const row of sourceRows) {
    const clone = row.cloneNode(true) as HTMLTableRowElement;
    const originals = [row, ...row.querySelectorAll<HTMLElement>("*")];
    const copies = [clone, ...clone.querySelectorAll<HTMLElement>("*")];
    originals.forEach((original, index) => {
      appearance(original, copies[index]);
      if (original.matches("th,td"))
        copies[index].style.width =
          `${original.getBoundingClientRect().width / scale}px`;
    });
    clone
      .querySelectorAll(".structure-marker,.write-caret,.pagination-spacer")
      .forEach((element) => element.remove());
    body.append(clone);
  }
  copy.append(body);
  copy.style.cssText += `;width:${rect.width / scale}px;min-width:0;margin:0;`;
  const wrapper = document.createElement("div");
  wrapper.className = "repeated-table-header";
  wrapper.dataset.sourceTable = String(header.table);
  wrapper.setAttribute("aria-hidden", "true");
  wrapper.setAttribute("inert", "");
  wrapper.style.cssText = `position:absolute;left:${(rect.left - origin.left) / scale - (canvasWidth - layout.width) / 2 + mirrorShiftToPage(view, header.table, page)}px;top:${pageInsets(layout).top + (header.offset || 0)}px;width:${rect.width / scale}px;height:${header.height}px;pointer-events:none;user-select:none;overflow:hidden;`;
  freezeTableLayout(table, copy, scale, true);
  wrapper.append(copy);
  return wrapper.outerHTML;
}
