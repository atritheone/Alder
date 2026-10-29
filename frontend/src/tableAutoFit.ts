import type { EditorView } from "prosemirror-view";
import { tableContext } from "./tableFormatting";

export function fitColumnWidths(
  natural: number[],
  available: number,
): number[] | null {
  const count = natural.length,
    limit = Math.floor(available);
  if (!count || !Number.isFinite(limit) || limit < count * 25) return null;
  const desired = natural.map((n) =>
    Math.max(25, Math.min(10000, Number.isFinite(n) ? Math.ceil(n) : 25)),
  );
  const total = desired.reduce((a, b) => a + b, 0);
  if (total <= limit) return desired;
  const extra = total - count * 25,
    room = limit - count * 25;
  const result = desired.map((n) => 25 + Math.floor(((n - 25) * room) / extra));
  let remaining = limit - result.reduce((a, b) => a + b, 0);
  for (let i = 0; remaining > 0; i = (i + 1) % count, remaining--) result[i]++;
  return result;
}

/** Measure an inert copy once for this explicit command, never during typing.
 * Chromium solves merged-cell constraints; widths are saved as ordinary columns. */
export function contentColumnWidths(view: EditorView): number[] | null {
  const context = tableContext(view.state);
  if (!context) return null;
  const wrapper = view.nodeDOM(context.tableStart - 1) as HTMLElement | null;
  const source = wrapper?.matches("table")
    ? (wrapper as HTMLTableElement)
    : wrapper?.querySelector("table");
  if (!source || !wrapper) return null;
  const containerCSS = getComputedStyle(wrapper);
  const available =
    wrapper.clientWidth -
    parseFloat(containerCSS.paddingLeft) -
    parseFloat(containerCSS.paddingRight);
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;contain:layout style;zoom:1";
  host.setAttribute("aria-hidden", "true");
  host.inert = true;
  const copy = source.cloneNode(true) as HTMLTableElement;
  const originals = [source, ...source.querySelectorAll<HTMLElement>("*")];
  const clones = [copy, ...copy.querySelectorAll<HTMLElement>("*")];
  originals.forEach((element, i) => {
    const target = clones[i],
      css = getComputedStyle(element);
    for (const property of [
      "font-family",
      "font-size",
      "font-style",
      "font-weight",
      "letter-spacing",
      "word-spacing",
      "line-height",
      "text-indent",
      "white-space",
      "padding",
      "border",
      "border-collapse",
      "border-spacing",
      "box-sizing",
    ])
      target.style.setProperty(property, css.getPropertyValue(property));
    target.removeAttribute("id");
    target.removeAttribute("contenteditable");
    target.style.height = "auto";
    target.style.minHeight = "0";
    target.style.maxWidth = "none";
    if (element instanceof HTMLImageElement) {
      target.style.width = `${element.offsetWidth}px`;
      target.style.height = `${element.offsetHeight}px`;
    }
  });
  copy
    .querySelectorAll(
      "colgroup,.pagination-spacer,.structure-marker,.column-resize-handle",
    )
    .forEach((n) => n.remove());
  copy.style.cssText +=
    ";table-layout:auto;width:max-content;min-width:0;max-width:none;margin:0";
  for (const row of copy.rows)
    for (const cell of row.cells) {
      cell.style.width = "auto";
      cell.style.minWidth = "25px";
      cell.removeAttribute("width");
    }
  host.append(copy);
  document.body.append(host);
  try {
    const tableRect = copy.getBoundingClientRect(),
      scale = tableRect.width / copy.offsetWidth;
    if (!Number.isFinite(scale) || scale <= 0) return null;
    const boundaries = new Map<number, number>([
      [0, 0],
      [context.map.width, tableRect.width / scale],
    ]);
    for (let row = 0; row < copy.rows.length; row++) {
      const seen = new Set<number>();
      let cell = 0;
      for (let column = 0; column < context.map.width; column++) {
        const pos = context.map.map[row * context.map.width + column];
        if (seen.has(pos)) continue;
        seen.add(pos);
        const area = context.map.findCell(pos);
        if (area.top !== row) continue;
        const dom = copy.rows[row].cells[cell++];
        if (!dom) continue;
        const rect = dom.getBoundingClientRect();
        boundaries.set(area.left, (rect.left - tableRect.left) / scale);
        boundaries.set(area.right, (rect.right - tableRect.left) / scale);
      }
    }
    const points = [...boundaries.keys()].sort((a, b) => a - b);
    for (let i = 1; i < points.length; i++) {
      const left = points[i - 1],
        right = points[i],
        start = boundaries.get(left)!,
        end = boundaries.get(right)!;
      for (let col = left + 1; col < right; col++)
        boundaries.set(
          col,
          start + ((end - start) * (col - left)) / (right - left),
        );
    }
    return fitColumnWidths(
      Array.from(
        { length: context.map.width },
        (_, col) => boundaries.get(col + 1)! - boundaries.get(col)!,
      ),
      available,
    );
  } finally {
    host.remove();
  }
}
