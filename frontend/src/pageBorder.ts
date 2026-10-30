import type { PageLayout } from "./pageFlow";

export type PageBorder = {
  style: "single" | "double" | "dashed" | "dotted";
  width: number;
  color: string;
  distance: number;
  display: "allPages" | "firstPage" | "notFirstPage";
};
export const defaultPageBorder: PageBorder = {
  style: "single",
  width: 1,
  color: "#273e5b",
  distance: 24,
  display: "allPages",
};
export function validPageBorder(
  value: unknown,
): value is PageBorder | null | undefined {
  if (value == null) return true;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  const b = value as PageBorder;
  return (
    Object.keys(b).every((k) =>
      ["style", "width", "color", "distance", "display"].includes(k),
    ) &&
    ["single", "double", "dashed", "dotted"].includes(b.style) &&
    typeof b.width === "number" &&
    Number.isFinite(b.width) &&
    b.width >= 0.25 &&
    b.width <= 6 &&
    Number.isInteger(b.width * 8) &&
    typeof b.color === "string" &&
    /^#[0-9a-f]{6}$/i.test(b.color) &&
    Number.isInteger(b.distance) &&
    b.distance >= 0 &&
    b.distance <= 31 &&
    ["allPages", "firstPage", "notFirstPage"].includes(b.display)
  );
}
export function borderVisible(
  border: PageBorder | null | undefined,
  page: number,
  start = 0,
) {
  return (
    !!border &&
    (border.display === "allPages" ||
      (page === start) === (border.display === "firstPage"))
  );
}
/** Physical coordinates only: borders do not consume body space or text positions. */
export function pageBorderDOM(layout: PageLayout, page: number) {
  const border = layout.pageBorder;
  if (!borderVisible(border, page, layout.sectionStartPage)) return null;
  const b = border!,
    ns = "http://www.w3.org/2000/svg",
    svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "page-border");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", String(layout.width));
  svg.setAttribute("height", String(layout.height));
  svg.style.cssText =
    "position:absolute;inset:0;pointer-events:none;user-select:none;overflow:hidden";
  const px = 4 / 3,
    width = b.width * px,
    distance = b.distance * px;
  const stroke = (inset: number, thickness: number) => {
    const rect = document.createElementNS(ns, "rect");
    for (const [key, value] of Object.entries({
      x: inset,
      y: inset,
      width: Math.max(0, layout.width - 2 * inset),
      height: Math.max(0, layout.height - 2 * inset),
      fill: "none",
      stroke: b.color,
      "stroke-width": thickness,
    }))
      rect.setAttribute(key, String(value));
    if (b.style === "dashed")
      rect.setAttribute("stroke-dasharray", `${width * 3} ${width * 2}`);
    if (b.style === "dotted")
      rect.setAttribute("stroke-dasharray", `${width} ${width}`);
    svg.append(rect);
  };
  if (b.style === "double") {
    stroke(distance + width / 2, width);
    stroke(distance + (5 * width) / 2, width);
  } else stroke(distance + width / 2, width);
  return svg;
}
