import { pageInsets } from "./pageGeometry";
import { mirroredPageLayout } from "./mirroredMargins";
import type { PageLayout } from "./pageFlow";
import { memo } from "react";
import { formatPageNumber } from "./pageNumbering";
import type { Schema } from "prosemirror-model";
import { runningMatterDOM } from "./runningMatter";
import { pageBorderDOM } from "./pageBorder";
import { watermarkDOM } from './watermark';

const fittedHeaders = new Map<string, string>();
if (typeof document !== "undefined")
  document.fonts?.addEventListener("loadingdone", () => fittedHeaders.clear());

type Item = { text: string; x: number; y: number; anchor: "start" | "middle" };
function items(layout: PageLayout, page: number): Item[] {
  const margins = pageInsets(layout);
  const result: Item[] = [];
  if (layout.header) {
    let text = layout.header.replace(/[\r\n]+/g, " ");
    const cacheKey = JSON.stringify([
      text,
      layout.fontFamily,
      layout.width,
      margins.left,
      margins.right,
    ]);
    if (fittedHeaders.has(cacheKey)) text = fittedHeaders.get(cacheKey)!;
    else {
      const context = document.createElement("canvas").getContext("2d");
      if (context) {
        context.font = `12px ${layout.fontFamily || "Cambria"}`;
        const width = layout.width - margins.left - margins.right;
        // Binary search rather than measuring every prefix of a long header.
        if (context.measureText(text).width > width) {
          const characters = Array.from(text);
          let low = 0,
            high = characters.length;
          while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            if (
              context.measureText(characters.slice(0, middle).join("") + "…")
                .width <= width
            )
              low = middle;
            else high = middle - 1;
          }
          text = characters.slice(0, low).join("") + "…";
        }
      }
      if (fittedHeaders.size >= 32)
        fittedHeaders.delete(fittedHeaders.keys().next().value!);
      fittedHeaders.set(cacheKey, text);
    }
    result.push({ text, x: margins.left, y: margins.top / 2, anchor: "start" });
  }
  if (layout.footer)
    result.push({
      text: formatPageNumber(
        page + (layout.pageNumberOffset ?? layout.firstPageNumber ?? 1),
        layout.pageNumberFormat,
      ),
      x: layout.width / 2,
      y: layout.height - margins.bottom / 2,
      anchor: "middle",
    });
  return result;
}

/** A publication header/footer is separate from the editable body. SVG keeps
 * its baseline in the same physical coordinates as the PDF drawing. */
export const PageFurniture = memo(function PageFurniture({
  layout,
  page,
  schema,
  pageCount,
}: {
  layout: PageLayout;
  page: number;
  schema: Schema;
  pageCount: number;
  fontVersion?: number;
}) {
  layout = mirroredPageLayout(layout, page);
  if (layout.runningMatter)
    return (
      <div
        className="page-furniture"
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        dangerouslySetInnerHTML={{
          __html:
            (watermarkDOM(layout)?.outerHTML || '') +
            (pageBorderDOM(layout, page)?.outerHTML || "") +
            runningMatterDOM(
              layout,
              page,
              pageCount,
              schema,
              layout.runningStyles,
            ).innerHTML,
        }}
      />
    );
  return (
    <svg
      className="page-furniture"
      aria-hidden="true"
      width={layout.width}
      height={layout.height}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        userSelect: "none",
        overflow: "hidden",
      }}
    >
      <g className="page-watermark" dangerouslySetInnerHTML={{__html:watermarkDOM(layout)?.innerHTML||''}}/>
      <g
        className="page-border"
        dangerouslySetInnerHTML={{
          __html: pageBorderDOM(layout, page)?.innerHTML || "",
        }}
      />
      {items(layout, page).map((item, i) => (
        <text
          key={i}
          x={item.x}
          y={item.y}
          textAnchor={item.anchor}
          fontFamily={layout.fontFamily || "Cambria"}
          fontSize="12"
          fill="#555555"
        >
          {item.text}
        </text>
      ))}
    </svg>
  );
});

export function pageFurnitureDOM(
  layout: PageLayout,
  page: number,
  schema: Schema,
  pageCount: number,
) {
  layout = mirroredPageLayout(layout, page);
  if (layout.runningMatter) {
    const result = runningMatterDOM(
      layout,
      page,
      pageCount,
      schema,
      layout.runningStyles,
    );
    const border = pageBorderDOM(layout, page);
    if (border) result.prepend(border);
    const watermark=watermarkDOM(layout);if(watermark)result.prepend(watermark);
    return result;
  }
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "page-furniture");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", String(layout.width));
  svg.setAttribute("height", String(layout.height));
  svg.style.cssText =
    "position:absolute;inset:0;pointer-events:none;user-select:none;overflow:hidden";
  const border = pageBorderDOM(layout, page);
  if (border) svg.append(border);
  const watermark=watermarkDOM(layout);if(watermark)svg.prepend(watermark);
  for (const item of items(layout, page)) {
    const text = document.createElementNS(ns, "text");
    for (const [key, value] of Object.entries({
      x: item.x,
      y: item.y,
      "text-anchor": item.anchor,
      "font-family": layout.fontFamily || "Cambria",
      "font-size": 12,
      fill: "#555555",
    }))
      text.setAttribute(key, String(value));
    text.textContent = item.text;
    svg.append(text);
  }
  return svg;
}
