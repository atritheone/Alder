import { noteSemanticPaths } from "./noteSemantics";
import { repeatingTableHeaders } from "./repeatingTableHeaders";
import type { DocNode } from "./types";
import type { NoteLine } from "./footnoteLayout";
import { documentText } from "./textProjection";
import { listNumber } from "./outlineLists";
import { splitNoteCellBands, type CellBand } from "./noteCellBands";

type Band = { top: number; bottom: number };
const headerRows = (table: HTMLTableElement) => {
  const rows = [...table.rows];
  return rows.slice(0, repeatingTableHeaders(rows.map(row => [...row.cells].map(cell => ({ header: cell.tagName === "TH", rowspan: cell.rowSpan })))));
};
type Ink = Band & {
  html: string;
  sourceFrom?: number;
  sourceImages?: number;
  paragraph?: number;
  through?: number;
  picture?: number;
  lane?: string;
};
type NoteSources = Map<string, number> & {
  paragraphIndices: Map<string, number>;
  semantics: ReturnType<typeof noteSemanticPaths>;
  imageStarts: Map<string, number>;
  pictures: { from: number; images: number }[];
};
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
export function indexNoteParagraphs(
  body: DocNode,
  prefix: number,
  continuation?: number[],
  imageStarts?: number[],
  pictureSources?: { from: number; images: number }[],
  origins?: number[],
  paragraphShift = 0,
) {
  const offsets = new Map<string, number>() as NoteSources;
  offsets.imageStarts = new Map();
  offsets.pictures = [];
  offsets.paragraphIndices = new Map();
  let offset = -prefix,
    image = 0;
  const walk = (node: DocNode) => {
    if (["image", "inline_image"].includes(node.type)) {
      offsets.pictures.push(
        pictureSources?.[image] ?? { from: Math.max(0, offset), images: image },
      );
      image++;
      return;
    }
    if (node.type === "paragraph") {
      const id = `note_measure_${offsets.size}`;
      node.attrs = { ...node.attrs, blockId: id };
      offsets.paragraphIndices.set(
        id,
        origins?.[offsets.size] ?? offsets.size - paragraphShift,
      );
      offsets.imageStarts.set(id, imageStarts?.[offsets.size] ?? image);
      offsets.set(id, continuation?.[offsets.size] ?? offset);
      node.content?.forEach((child) => {
        if (["image", "inline_image"].includes(child.type)) walk(child);
        else offset += documentText(child).length;
      });
      return;
    }
    node.content?.forEach((child, index) => {
      if (index && separated.has(node.type)) offset++;
      walk(child);
    });
  };
  walk(body);
  offsets.semantics = noteSemanticPaths(body);
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
  offsets: NoteSources,
  width: number,
  maximum = Infinity,
): MeasuredNoteLines {
  const origin = host.getBoundingClientRect(),
    scale = origin.width / width;
  const inks: Ink[] = [],
    intervals: Band[] = [],
    paint: Ink[] = [];
  const overflowingRows: string[] = [];
  const order = new WeakMap<Node, number>();
  let orderIndex = 0;
  const ordered = document.createTreeWalker(host, NodeFilter.SHOW_ALL);
  while (ordered.nextNode()) order.set(ordered.currentNode, orderIndex++);
  const keeps: (Band & { lane?: string })[] = [];
  const bounds = (rect: DOMRect) => ({
    top: (rect.top - origin.top) / scale,
    bottom: (rect.bottom - origin.top) / scale,
  });
  const positioned = (
    element: HTMLElement,
    rect: DOMRect,
    sourceFrom?: number,
    sourceImages?: number,
  ) => {
    element.style.cssText += `;position:absolute;left:${(rect.left - origin.left) / scale}px;top:${(rect.top - origin.top) / scale}px;white-space:pre;`;
    const ink = {
      ...bounds(rect),
      html: element.outerHTML,
      sourceFrom,
      sourceImages,
    };
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
    const headers = headerRows(table);
    // Frozen rows use display:contents, so only their cells have a box.
    const boxes = headers.flatMap((row) =>
      [...row.cells].map((cell) => cell.getBoundingClientRect()),
    );
    const height =
      !headers.length
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
        if (
          paragraph.dataset.noteContinuedItem ||
          paragraph.style.display === "none"
        ) {
          (item as HTMLElement).style.listStyleType = "none";
          return;
        }
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
    let imageOffset =
      offsets.imageStarts.get(paragraph.dataset.referenceTarget!) || 0;
    const paragraphIndex =
      offsets.paragraphIndices.get(paragraph.dataset.referenceTarget!) ?? -1;
    const lane = paragraph.dataset.referenceTarget!;
    const repeated = !!paragraph.closest("[data-note-repeated-header]");
    if (offset == null) continue;
    const box = paragraph.getBoundingClientRect(),
      css = getComputedStyle(paragraph);
    if (css.display === "none") continue;
    const walker = document.createTreeWalker(
      paragraph,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) =>
          node.nodeType === Node.TEXT_NODE ||
          ["BR", "IMG"].includes((node as Element).tagName)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP,
      },
    );
    let hasInk = false;
    while (walker.nextNode()) {
      if (walker.currentNode.nodeType !== Node.TEXT_NODE) {
        if ((walker.currentNode as Element).tagName === "IMG") {
          if (
            !(walker.currentNode as Element).classList.contains(
              "ProseMirror-separator",
            )
          )
            imageOffset++;
          continue;
        }
        if (
          !(walker.currentNode as Element).classList.contains(
            "ProseMirror-trailingBreak",
          )
        ) {
          offset++;
          const previous = inks.at(-1);
          if (!repeated && previous?.paragraph === paragraphIndex)
            previous.through = offset;
        }
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
          span.dataset.noteStructure = JSON.stringify(
            offsets.semantics.paragraphs.get(
              paragraph.dataset.referenceTarget!,
            ) || [],
          );
          span.dataset.noteOrder = JSON.stringify([
            offset + start - (generated ? 0.5 : 0),
            order.get(text) || 0,
            start,
          ]);
          if (repeated) {
            span.setAttribute("aria-hidden", "true");
            span.dataset.noteRepeatedInk = "true";
          }
          if (generated) span.dataset.noteListMarker = "true";
          const language = text.parentElement
            ?.closest("[lang]")
            ?.getAttribute("lang");
          if (language) span.lang = language;
          if (!generated && !repeated && offset + start >= 0) {
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
            positioned(
              span,
              box,
              Math.max(0, offset + (generated ? 0 : start)),
              imageOffset,
            );
            inks.at(-1)!.html = link.outerHTML;
          } else
            positioned(
              span,
              box,
              Math.max(0, offset + (generated ? 0 : start)),
              imageOffset,
            );
          inks.at(-1)!.lane = lane;
          if (!generated && !repeated && paragraphIndex >= 0) {
            inks.at(-1)!.paragraph = paragraphIndex;
            inks.at(-1)!.through = offset + start + match[0].length;
          }
          hasInk = true;
        }
        from = lo;
      }
      if (!generated) {
        offset += text.length;
        const previous = inks.at(-1);
        if (!repeated && previous?.paragraph === paragraphIndex)
          previous.through = offset;
      }
    }
    if (
      !hasInk &&
      !paragraph.querySelector("img:not(.ProseMirror-separator)")
    ) {
      intervals.push(bounds(box));
      inks.push({
        ...bounds(box),
        html: "",
        lane,
        sourceFrom: Math.max(0, offset),
        sourceImages: imageOffset,
        ...(!repeated && paragraphIndex >= 0
          ? { paragraph: paragraphIndex, through: offset }
          : {}),
      });
    }
    // Authored keep-together remains meaningful inside the note story.
    if (
      css.breakInside === "avoid" &&
      box.height / scale + headerHeight(paragraph) <= maximum
    ) {
      intervals.push(bounds(box));
      keeps.push({ ...bounds(box), lane });
    }
  }
  let pictureIndex = 0;
  for (const image of host.querySelectorAll<HTMLImageElement>(
    "img:not(.ProseMirror-separator)",
  )) {
    const box = image.getBoundingClientRect();
    const source = offsets.pictures[pictureIndex++];
    if (!box.width || !box.height) continue;
    const copy = image.cloneNode(true) as HTMLImageElement;
    copy.dataset.noteStructure = JSON.stringify(
      offsets.semantics.pictures[pictureIndex - 1] || [],
    );
    copy.dataset.noteOrder = JSON.stringify([
      source?.from || 0,
      order.get(image) || 0,
      0,
    ]);
    if (image.closest("[data-note-repeated-header]")) {
      copy.setAttribute("aria-hidden", "true");
      copy.dataset.noteRepeatedInk = "true";
    }
    copy.removeAttribute("id");
    copy.removeAttribute("data-block-id");
    copy.style.cssText = `width:${box.width / scale}px;height:${box.height / scale}px;max-width:none`;
    positioned(copy, box, source?.from, source?.images);
    inks.at(-1)!.lane =
      image.closest<HTMLElement>("p[data-reference-target]")?.dataset
        .referenceTarget || `picture_${pictureIndex}`;
    if (!image.closest("[data-note-repeated-header]"))
      inks.at(-1)!.picture = source?.images;
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
      if (interval.bottom - interval.top + headerHeight(row) <= maximum) {
        intervals.push(interval);
        keeps.push(interval);
      } else if (row.dataset.noteRowId)
        overflowingRows.push(row.dataset.noteRowId);
    }
  }
  let available = Math.max(
    1,
    maximum -
      Math.max(
        0,
        ...[...host.querySelectorAll<HTMLElement>("td,th")].map(headerHeight),
      ),
  );
  const initialBands = noteBands(
    intervals,
    host.getBoundingClientRect().height / scale,
    available,
  );
  for (const { headers, height } of tableHeaders.values()) {
    if (!headers.length || height <= 0) continue;
    const boxes = headers.flatMap((row) =>
      [...row.cells].map((cell) => bounds(cell.getBoundingClientRect())),
    );
    const top = Math.min(...boxes.map((box) => box.top)),
      bottom = Math.max(...boxes.map((box) => box.bottom));
    const headingSpace = initialBands
      .filter((band) => band.top < bottom - 0.1 && band.bottom > top + 0.1)
      .reduce((sum, band) => sum + band.bottom - band.top, 0);
    available = Math.min(available, Math.max(1, maximum - headingSpace));
  }
  const bands = splitNoteCellBands(
    initialBands,
    inks.map((ink, index) => ({ ...ink, lane: ink.lane || `ink_${index}` })),
    maximum,
    keeps,
    maximum - available,
  );
  const renderBand = (band: CellBand): NoteLine => {
    const decoration = paint
      .filter((item) => item.top < band.bottom && item.bottom > band.top)
      .map((item) => item.html)
      .join("");
    const owned = inks.filter((item, index) =>
      band.members
        ? band.members.has(index)
        : item.top >= band.top - 0.1 && item.top < band.bottom - 0.1,
    );
    const content = owned.map((item) => item.html).join("");
    const paragraphs = new Map<number, number>(),
      pictures: number[] = [];
    for (const item of owned) {
      if (item.paragraph != null && item.through != null)
        paragraphs.set(
          item.paragraph,
          Math.max(paragraphs.get(item.paragraph) ?? -Infinity, item.through),
        );
      if (item.picture != null) pictures.push(item.picture);
    }
    return {
      height: band.bottom - band.top,
      read: { paragraphs: [...paragraphs], pictures },
      sourceFrom: owned.reduce<number | undefined>(
        (first, item) =>
          item.sourceFrom == null
            ? first
            : Math.min(first ?? Infinity, item.sourceFrom),
        undefined,
      ),
      sourceImages: owned.reduce<number | undefined>(
        (first, item) =>
          item.sourceImages == null
            ? first
            : Math.min(first ?? Infinity, item.sourceImages),
        undefined,
      ),
      html: `<div style="position:relative;height:${band.bottom - band.top}px"><div aria-hidden="true" style="position:absolute;inset:0;overflow:hidden"><div style="position:relative;top:${-band.top}px">${decoration}</div></div><div style="position:relative;top:${-band.top}px">${content}</div></div>`,
    };
  };
  const result: MeasuredNoteLines = bands.map(renderBand);
  result.overflowingRows = overflowingRows;
  for (const table of host.querySelectorAll<HTMLTableElement>("table")) {
    if (table.parentElement?.closest("table")) continue;
    const headers = headerRows(table);
    if (!headers.length) continue;
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
