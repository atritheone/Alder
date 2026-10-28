import { pageInsets } from "./pageGeometry";
import type { PageLayout } from "./pageFlow";
import { memo } from "react";

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
      text: String(page + (layout.firstPageNumber || 1)),
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
}: {
  layout: PageLayout;
  page: number;
  fontVersion?: number;
}) {
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

export function pageFurnitureDOM(layout: PageLayout, page: number) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "page-furniture");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", String(layout.width));
  svg.setAttribute("height", String(layout.height));
  svg.style.cssText =
    "position:absolute;inset:0;pointer-events:none;user-select:none;overflow:hidden";
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
