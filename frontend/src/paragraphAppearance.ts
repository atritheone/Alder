import type { StyleProperties } from "./types";

export const paragraphAppearanceKeys = [
  "paragraphBackground",
  "paragraphBorderColor",
  "paragraphBorderWidth",
  "paragraphPadding",
] as const;
export const paragraphColour = (value: unknown) =>
  typeof value === "string" && /^(#[0-9a-f]{6}|transparent)$/i.test(value);
export function paragraphAppearanceCSS(values: StyleProperties) {
  const css: string[] = [];
  if (paragraphColour(values.paragraphBackground))
    css.push(`background-color:${values.paragraphBackground}`);
  if (paragraphColour(values.paragraphBorderColor))
    css.push(`outline-color:${values.paragraphBorderColor}`);
  if (
    typeof values.paragraphBorderWidth === "number" &&
    values.paragraphBorderWidth >= 0 &&
    values.paragraphBorderWidth <= 12
  )
    css.push(
      `outline-style:solid;outline-width:${values.paragraphBorderWidth}pt;outline-offset:${-values.paragraphBorderWidth}pt`,
    );
  if (
    typeof values.paragraphPadding === "number" &&
    values.paragraphPadding >= 0 &&
    values.paragraphPadding <= 31
  )
    css.push(`padding:${values.paragraphPadding}pt`);
  return css.join(";");
}
function colour(value: string) {
  if (paragraphColour(value)) return value;
  const rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(value);
  return rgb
    ? "#" +
        rgb
          .slice(1)
          .map((v) => Number(v).toString(16).padStart(2, "0"))
          .join("")
    : null;
}
export function paragraphAppearanceFromDOM(dom: HTMLElement) {
  const number = (value: string) =>
    /^\d+(?:\.\d+)?(?:pt|px)$/.test(value)
      ? parseFloat(value) * (value.endsWith("px") ? 0.75 : 1)
      : null;
  return {
    paragraphBackground: colour(dom.style.backgroundColor),
    paragraphBorderColor: colour(
      dom.style.borderTopColor || dom.style.outlineColor,
    ),
    paragraphBorderWidth:
      (dom.style.borderTopStyle || dom.style.outlineStyle) === "none"
        ? 0
        : number(dom.style.borderTopWidth || dom.style.outlineWidth),
    paragraphPadding: number(dom.style.paddingTop),
  };
}
