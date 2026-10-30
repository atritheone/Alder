import type { DocNode } from "./types";
import type { NoteLine } from "./footnoteLayout";
import { documentText } from "./textProjection";
import { listNumber } from "./outlineLists";

type Band = { top: number; bottom: number };
type Ink = Band & { html: string };
export type MeasuredNoteLines = NoteLine[] & { overflowingRows?: string[] };
const separated = new Set([
  "doc",
  "bullet_list",
  "ordered_list",
  "list_item",
  "table",
  "table_row",
  "table_cell",
  "table_header",
]);

/** Derived paragraph identities join measured DOM to the exact narration
 * projection. Container separators count once, including empty table cells. */
export function indexNoteParagraphs(body: DocNode, prefix: number) {
  const offsets = new Map<string, number>();
  let offset = -prefix;
  const walk = (node: DocNode) => {
    if (node.type === "paragraph") {
      const id = `note_measure_${offsets.size}`;
      node.attrs = { ...node.attrs, blockId: id };
      offsets.set(id, offset);
      offset += documentText(node).length;
      return;
    }
    node.content?.forEach((child, index) => {
      if (index && separated.has(node.type)) offset++;
      walk(child);
    });
  };
  walk(body);
  return offsets;
}

/** Union overlapping glyph/image intervals. A break may pass through a table
 * cell's empty area, never through a line in either parallel cell story. */
export function noteBands(
  intervals: Band[],
  height: number,
  maximum = Infinity,
): Band[] {
  const groups: Band[] = [];
  for (const interval of [...intervals].sort((a, b) => a.top - b.top)) {
    const last = groups.at(-1);
    if (last && interval.top < last.bottom - 0.1)
      last.bottom = Math.max(last.bottom, interval.bottom);
    else groups.push({ ...interval });
  }
  return groups.flatMap((group, index) => {
    let top = index ? group.top : 0;
    const bottom = groups[index + 1]?.top ?? Math.max(height, group.bottom),
      result: Band[] = [];
    // Split oversized empty spacing only after the whole glyph/image group.
    while (
      maximum > 0 &&
      bottom - top > maximum &&
      top + maximum >= group.bottom
    ) {
      result.push({ top, bottom: top + maximum });
      top += maximum;
    }
    result.push({ top, bottom });
    return result;
  });
}

/** Composite note stories keep only each band's own text and pictures. Cell
 * decoration is clipped independently; no hidden duplicate wording is printed.
 * This also permits a long row to continue with unequal cell line heights. */
export function measureRichNoteLines(
  host: HTMLElement,
  offsets: Map<string, number>,
  width: number,
  maximum = Infinity,
): MeasuredNoteLines {
  const origin = host.getBoundingClientRect(),
    scale = origin.width / width;
  const inks: Ink[] = [],
    intervals: Band[] = [],
    paint: Ink[] = [];
  const overflowingRows: string[] = [];
  const bounds = (rect: DOMRect) => ({
    top: (rect.top - origin.top) / scale,
    bottom: (rect.bottom - origin.top) / scale,
  });
  const positioned = (element: HTMLElement, rect: DOMRect) => {
    element.style.cssText += `;position:absolute;left:${(rect.left - origin.left) / scale}px;top:${(rect.top - origin.top) / scale}px;white-space:pre;`;
    const ink = { ...bounds(rect), html: element.outerHTML };
    inks.push(ink);
    intervals.push(ink);
  };
  const tableHeaders = new Map<
    HTMLTableElement,
    { height: number; headers: HTMLTableRowElement[] }
  >();
  const headerHeight = (element: HTMLElement) => {
    const table = element.closest("table");
    if (!table) return 0;
    const existing = tableHeaders.get(table);
    if (existing)
      return existing.headers.some(
        (row) => row === element || row.contains(element),
      )
        ? 0
        : existing.height;
    const rows = [...table.rows],
      headers: HTMLTableRowElement[] = [];
    for (const row of rows) {
      if (
        !row.cells.length ||
        ![...row.cells].every((cell) => cell.tagName === "TH")
      )
        break;
      headers.push(row);
    }
    const boxes = headers.map((row) => row.getBoundingClientRect());
    const height =
      !headers.length || headers.length === rows.length
        ? 0
        : (Math.max(...boxes.map((box) => box.bottom)) -
            Math.min(...boxes.map((box) => box.top))) /
          scale;
    tableHeaders.set(table, { height, headers });
    return headers.some((row) => row === element || row.contains(element))
      ? 0
      : height;
  };
  // Browser ::marker has no Range. Materialise ordinary labels in the same
  // hanging space; outline labels already have measured widgets.
  for (const list of host.querySelectorAll<HTMLOListElement>("ol,ul")) {
    if (list.classList.contains("outline-list")) continue;
    const format = getComputedStyle(list).listStyleType;
    [...list.children]
      .filter((item) => item.tagName === "LI")
      .forEach((item, index) => {
        const paragraph = item.querySelector<HTMLElement>(":scope > p");
        if (!paragraph) return;
        const marker = document.createElement("span"),
          css = getComputedStyle(paragraph);
        marker.dataset.outlineNumber = "true";
        marker.textContent =
          list.tagName === "OL"
            ? listNumber((list.start || 1) + index, format) + "."
            : { disc: "\u2022", circle: "\u25e6", square: "\u25aa" }[format] ||
              "\u2022";
        marker.style.cssText = `position:absolute;right:calc(100% + .4em);top:0;white-space:pre;font:${css.font}`;
        paragraph.style.position = "relative";
        paragraph.prepend(marker);
        (item as HTMLElement).style.listStyleType = "none";
      });
  }
  for (const paragraph of host.querySelectorAll<HTMLElement>(
    "p[data-reference-target]",
  )) {
    let offset = offsets.get(paragraph.dataset.referenceTarget!);
    if (offset == null) continue;
    const box = paragraph.getBoundingClientRect(),
      css = getComputedStyle(paragraph);
    const walker = document.createTreeWalker(
      paragraph,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) =>
          node.nodeType === Node.TEXT_NODE || (node as Element).tagName === "BR"
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP,
      },
    );
    let hasInk = false;
    while (walker.nextNode()) {
      if (walker.currentNode.nodeType !== Node.TEXT_NODE) {
        if (
          !(walker.currentNode as Element).classList.contains(
            "ProseMirror-trailingBreak",
          )
        )
          offset++;
        continue;
      }
      const text = walker.currentNode as Text,
        style = getComputedStyle(text.parentElement!);
      const generated = !!text.parentElement?.closest("[data-outline-number]");
      const range = document.createRange();
      const rect = (from: number, to: number) => {
        range.setStart(text, from);
        range.setEnd(text, to);
        return range.getBoundingClientRect();
      };
      let from = 0;
      while (from < text.length) {
        const first = rect(from, from + 1);
        let lo = from + 1,
          hi = text.length;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2),
            last = rect(mid - 1, mid);
          if (last.top < first.bottom - 0.5 && last.bottom > first.top + 0.5)
            lo = mid;
          else hi = mid - 1;
        }
        for (const match of text.data.slice(from, lo).matchAll(/\S+|\s+/gu)) {
          const start = from + match.index!,
            box = rect(start, start + match[0].length);
          if (box.width <= 0.1) continue;
          const span = document.createElement("span");
          span.textContent = match[0];
          const language = text.parentElement
            ?.closest("[lang]")
            ?.getAttribute("lang");
          if (language) span.lang = language;
          if (!generated && offset + start >= 0) {
            span.dataset.noteFrom = String(offset + start);
            span.dataset.noteTo = String(offset + start + match[0].length);
          }
          for (const prop of [
            "font-family",
            "font-size",
            "font-weight",
            "font-style",
            "font-variant",
            "letter-spacing",
            "word-spacing",
            "color",
            "background-color",
            "text-decoration",
          ])
            span.style.setProperty(prop, style.getPropertyValue(prop));
          span.style.lineHeight = `${box.height / scale}px`;
          if (text.parentElement?.classList.contains("alder-tab")) {
            span.className = "alder-tab";
            span.style.width = `${box.width / scale}px`;
            for (const prop of [
              "background-image",
              "background-size",
              "--alder-tab-leader-y",
              "tab-size",
            ])
              span.style.setProperty(prop, style.getPropertyValue(prop));
          }
          const anchor =
            text.parentElement?.closest<HTMLAnchorElement>("a[href]");
          if (
            anchor &&
            /^(https?:|mailto:|#)/i.test(anchor.getAttribute("href") || "")
          ) {
            const link = document.createElement("a");
            link.setAttribute("href", anchor.getAttribute("href")!);
            link.append(span);
            positioned(span, box);
            inks.at(-1)!.html = link.outerHTML;
          } else positioned(span, box);
          hasInk = true;
        }
        from = lo;
      }
      if (!generated) offset += text.length;
    }
    if (!hasInk) intervals.push(bounds(box));
    // Authored keep-together remains meaningful inside the note story.
    if (
      css.breakInside === "avoid" &&
      box.height / scale + headerHeight(paragraph) <= maximum
    )
      intervals.push(bounds(box));
  }
  for (const image of host.querySelectorAll<HTMLImageElement>(
    "img:not(.ProseMirror-separator)",
  )) {
    const box = image.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    const copy = image.cloneNode(true) as HTMLImageElement;
    copy.removeAttribute("id");
    copy.removeAttribute("data-block-id");
    copy.style.cssText = `width:${box.width / scale}px;height:${box.height / scale}px;max-width:none`;
    positioned(copy, box);
  }
  for (const cell of host.querySelectorAll<HTMLElement>("td,th,p")) {
    const box = cell.getBoundingClientRect(),
      css = getComputedStyle(cell),
      copy = document.createElement("div");
    copy.setAttribute("aria-hidden", "true");
    copy.style.cssText = `position:absolute;left:${(box.left - origin.left) / scale}px;top:${(box.top - origin.top) / scale}px;width:${box.width / scale}px;height:${box.height / scale}px;box-sizing:border-box;`;
    for (const prop of [
      "background-color",
      "box-shadow",
      "outline-style",
      "outline-width",
      "outline-color",
      "outline-offset",
      ...["top", "right", "bottom", "left"].flatMap((edge) =>
        ["style", "width", "color"].map((part) => `border-${edge}-${part}`),
      ),
    ])
      copy.style.setProperty(prop, css.getPropertyValue(prop));
    paint.push({ ...bounds(box), html: copy.outerHTML });
  }
  for (const row of host.querySelectorAll<HTMLTableRowElement>(
    'tr[data-allow-split="false"]',
  )) {
    const cells = [...row.cells].map((cell) =>
      bounds(cell.getBoundingClientRect()),
    );
    if (cells.length) {
      const interval = {
        top: Math.min(...cells.map((cell) => cell.top)),
        bottom: Math.max(...cells.map((cell) => cell.bottom)),
      };
      if (interval.bottom - interval.top + headerHeight(row) <= maximum)
        intervals.push(interval);
      else if (row.dataset.noteRowId)
        overflowingRows.push(row.dataset.noteRowId);
    }
  }
  const bands = noteBands(
    intervals,
    host.getBoundingClientRect().height / scale,
    Math.max(
      1,
      maximum -
        Math.max(
          0,
          ...[...host.querySelectorAll<HTMLElement>("td,th")].map(headerHeight),
        ),
    ),
  );
  const renderBand = (band: Band): NoteLine => {
    const decoration = paint
      .filter((item) => item.top < band.bottom && item.bottom > band.top)
      .map((item) => item.html)
      .join("");
    const content = inks
      .filter(
        (item) => item.top >= band.top - 0.1 && item.top < band.bottom - 0.1,
      )
      .map((item) => item.html)
      .join("");
    return {
      height: band.bottom - band.top,
      html: `<div style="position:relative;height:${band.bottom - band.top}px"><div aria-hidden="true" style="position:absolute;inset:0;overflow:hidden"><div style="position:relative;top:${-band.top}px">${decoration}</div></div><div style="position:relative;top:${-band.top}px">${content}</div></div>`,
    };
  };
  const result: MeasuredNoteLines = bands.map(renderBand);
  result.overflowingRows = overflowingRows;
  for (const table of host.querySelectorAll<HTMLTableElement>("table")) {
    if (table.parentElement?.closest("table")) continue;
    const rows = [...table.rows],
      headers = [];
    for (const row of rows) {
      if (
        !row.cells.length ||
        ![...row.cells].every((cell) => cell.tagName === "TH")
      )
        break;
      headers.push(row);
    }
    if (!headers.length || headers.length === rows.length) continue;
    const cells = headers.flatMap((row) =>
        [...row.cells].map((cell) => bounds(cell.getBoundingClientRect())),
      ),
      header = {
        top: Math.min(...cells.map((c) => c.top)),
        bottom: Math.max(...cells.map((c) => c.bottom)),
      };
    const end = bounds(table.getBoundingClientRect()).bottom,
      repeat = renderBand(header),
      copy = document.createElement("div");
    copy.setAttribute("aria-hidden", "true");
    copy.dataset.noteRepeatedHeader = "true";
    copy.innerHTML = repeat.html;
    copy.querySelectorAll("[data-note-from]").forEach((node) => {
      node.removeAttribute("data-note-from");
      node.removeAttribute("data-note-to");
    });
    repeat.html = copy.outerHTML;
    bands.forEach((band, index) => {
      if (band.top >= header.bottom - 0.1 && band.top < end - 0.1)
        result[index].repeat = [repeat];
      if (band.top >= header.top - 0.1 && band.top < header.bottom - 0.1)
        result[index].keepWithNext = true;
    });
  }
  return result;
}
