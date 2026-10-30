import type { PageLayout } from "./pageFlow";
export type Watermark = {
  text: string;
  fontFamily: string;
  color: string;
  widthMm: number;
  heightMm: number;
  angle: number;
};
export const defaultWatermark: Watermark = {
  text: "DRAFT",
  fontFamily: "Cambria",
  color: "#d0d0d0",
  widthMm: 90,
  heightMm: 18,
  angle: 315,
};
export function validWatermark(
  value: unknown,
): value is Watermark | null | undefined {
  if (value == null) return true;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  const w = value as Watermark;
  return (
    Object.keys(w).every((k) =>
      ["text", "fontFamily", "color", "widthMm", "heightMm", "angle"].includes(
        k,
      ),
    ) &&
    typeof w.text === "string" &&
    w.text.trim().length > 0 &&
    [...w.text].length <= 120 &&
    !/[\u0000-\u001f\u007f]/.test(w.text) &&
    typeof w.fontFamily === "string" &&
    w.fontFamily.length > 0 &&
    w.fontFamily.length <= 100 &&
    !/[\u0000-\u001f;<>"\\]/.test(w.fontFamily) &&
    /^#[0-9a-f]{6}$/i.test(w.color) &&
    [w.widthMm, w.heightMm].every(
      (v) => typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 1000,
    ) &&
    typeof w.angle === "number" &&
    Number.isInteger(w.angle) &&
    w.angle >= 0 &&
    w.angle < 360
  );
}
const cached = new Map<string, string>();
export function naturalWatermarkHeight(
  text: string,
  fontFamily: string,
  widthMm: number,
) {
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.font = `100px "${fontFamily.replace(/["\\]/g, "\\$&")}", "Liberation Serif", serif`;
  const m = ctx.measureText(text);
  return (
    Math.round(
      Math.min(
        1000,
        Math.max(
          1,
          (widthMm * (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent)) /
            Math.max(1, m.actualBoundingBoxLeft + m.actualBoundingBoxRight),
        ),
      ) * 100,
    ) / 100
  );
}
if (typeof document !== "undefined")
  document.fonts?.addEventListener("loadingdone", () => cached.clear());
/** Decorative page paint. No editable nodes, speech offsets or line geometry. */
export function watermarkDOM(layout: PageLayout) {
  const w = layout.watermark;
  if (!w) return null;
  const key = JSON.stringify([w, layout.width, layout.height]);
  const ns = "http://www.w3.org/2000/svg",
    svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "page-watermark");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", String(layout.width));
  svg.setAttribute("height", String(layout.height));
  svg.style.cssText =
    "position:absolute;inset:0;pointer-events:none;user-select:none;overflow:hidden";
  if (cached.has(key)) {
    svg.innerHTML = cached.get(key)!;
    return svg;
  }
  const ctx = document.createElement("canvas").getContext("2d")!;
  const family = `"${w.fontFamily.replace(/["\\]/g, "\\$&")}", "Liberation Serif", serif`;
  ctx.font = `100px ${family}`;
  const m = ctx.measureText(w.text),
    width = (w.widthMm * 96) / 25.4,
    height = (w.heightMm * 96) / 25.4;
  const g = document.createElementNS(ns, "g"),
    text = document.createElementNS(ns, "text");
  g.setAttribute(
    "transform",
    `translate(${layout.width / 2},${layout.height / 2}) rotate(${w.angle}) translate(${-width / 2},${-height / 2}) scale(${width / Math.max(1, m.actualBoundingBoxLeft + m.actualBoundingBoxRight)},${height / Math.max(1, m.actualBoundingBoxAscent + m.actualBoundingBoxDescent)})`,
  );
  for (const [key, value] of Object.entries({
    x: m.actualBoundingBoxLeft,
    y: m.actualBoundingBoxAscent,
    "font-family": family,
    "font-size": 100,
    fill: w.color,
  }))
    text.setAttribute(key, String(value));
  text.textContent = w.text;
  g.append(text);
  svg.append(g);
  if (cached.size >= 64) cached.delete(cached.keys().next().value!);
  cached.set(key, svg.innerHTML);
  return svg;
}
