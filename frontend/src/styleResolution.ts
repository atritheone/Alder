import type {
  NamedStyle,
  StyleKind,
  StyleProperties,
  Project,
  DocNode,
} from "./types";

export type ResolvedStyle = StyleProperties & {
  id: string;
  name: string;
  kind: StyleKind;
};
const propertyNames = [
  "fontFamily",
  "fontSize",
  "lineHeight",
  "spaceAfter",
  "color",
  "align",
  "leftIndent",
  "firstLineIndent",
] as const;
const numericBounds: Record<string, [number, number]> = {
  fontSize: [6, 72],
  lineHeight: [1, 3],
  spaceAfter: [0, 144],
  leftIndent: [-144, 144],
  firstLineIndent: [-144, 144],
};
const inherited = (value: unknown) =>
  value === undefined || value === null || value === "";
const validColor = (value: string) =>
  /^(?:#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})|[a-z]{1,30})$/i.test(
    value,
  );

/** Null, missing, and empty values inherit; zero spacing/indent is explicit. */
export function resolveStyles(
  styles: NamedStyle[],
): Map<string, ResolvedStyle> {
  const byId = new Map<string, NamedStyle>(),
    resolved = new Map<string, ResolvedStyle>(),
    visiting = new Set<string>();
  for (const style of styles) {
    if (!style.id || byId.has(style.id))
      throw new Error("Each style needs a unique identity.");
    if (typeof style.name !== "string" || !style.name.trim())
      throw new Error("Give every style a name.");
    if (style.kind && style.kind !== "paragraph" && style.kind !== "character")
      throw new Error(`Unknown style kind for “${style.name}”.`);
    byId.set(style.id, style);
  }
  function visit(id: string): ResolvedStyle {
    const cached = resolved.get(id);
    if (cached) return cached;
    const style = byId.get(id);
    if (!style) throw new Error("A style refers to a missing base style.");
    if (visiting.has(id))
      throw new Error(`Style inheritance contains a cycle at “${style.name}”.`);
    visiting.add(id);
    const base = style.basedOn ? visit(style.basedOn) : undefined;
    const result: ResolvedStyle = {
      ...base,
      id: style.id,
      name: style.name,
      kind: style.kind || "paragraph",
    };
    for (const key of propertyNames) {
      const value = style[key];
      if (inherited(value)) continue;
      if (key in numericBounds) {
        const [low, high] = numericBounds[key];
        if (
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          value < low ||
          value > high
        )
          throw new Error(
            `“${style.name}” has an invalid ${key} value (${low}–${high}).`,
          );
      } else if (
        key === "align" &&
        !["left", "center", "right", "justify"].includes(String(value))
      )
        throw new Error(`“${style.name}” has an invalid alignment.`);
      else if (key === "color" && !validColor(String(value)))
        throw new Error(
          `“${style.name}” needs a colour name or hexadecimal colour.`,
        );
      else if (
        key === "fontFamily" &&
        (typeof value !== "string" ||
          value.length > 200 ||
          /[\x00-\x1f]/.test(value))
      )
        throw new Error(`“${style.name}” has an invalid font family.`);
      (result as Record<string, unknown>)[key] = value;
    }
    visiting.delete(id);
    resolved.set(id, result);
    return result;
  }
  for (const id of byId.keys()) visit(id);
  return resolved;
}

const cssString = (text: string) =>
  text.replace(
    /["\\\x00-\x1f<>]/g,
    (char) => `\\${char.codePointAt(0)!.toString(16)} `,
  );
const fontValue = (font: string) =>
  font
    .split(",")
    .map((part) => {
      const name = part.trim().replace(/^['"]|['"]$/g, "");
      return /^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(
        name,
      )
        ? name
        : `"${cssString(name)}"`;
    })
    .join(",");

/** Safe CSS shared by named rules and higher-priority direct formatting. */
export function styleDeclarations(
  style: StyleProperties,
  kind: StyleKind = "paragraph",
): string {
  const css: string[] = [];
  if (typeof style.fontFamily === "string" && style.fontFamily.trim())
    css.push(`font-family:${fontValue(style.fontFamily)}`);
  const number = (key: keyof StyleProperties, cssName: string, unit = "pt") => {
    const value = style[key],
      bounds = numericBounds[key];
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= bounds[0] &&
      value <= bounds[1]
    )
      css.push(`${cssName}:${value}${unit}`);
  };
  number("fontSize", "font-size");
  if (
    typeof style.color === "string" &&
    (validColor(style.color) || /^rgba?\([\d.,%\s/]+\)$/i.test(style.color))
  )
    css.push(`color:${style.color}`);
  if (kind === "paragraph") {
    number("lineHeight", "line-height", "");
    number("spaceAfter", "margin-bottom");
    number("leftIndent", "margin-left");
    number("firstLineIndent", "text-indent");
    if (
      style.align &&
      ["left", "center", "right", "justify"].includes(style.align)
    )
      css.push(`text-align:${style.align}`);
  }
  return css.join(";");
}

/** The instance scope prevents one open editor's styles affecting another. */
export function styleSheet(styles: NamedStyle[], scope: string): string {
  const prefix = `[data-alder-editor="${cssString(scope)}"] .ProseMirror`;
  return [...resolveStyles(styles).values()]
    .map((style) => {
      const target =
        style.kind === "character" ? "span" : ":is(p,h1,h2,h3,h4,h5,h6,pre)";
      return `${prefix} ${target}[data-style="${cssString(style.id)}"]{${styleDeclarations(style, style.kind)}}`;
    })
    .join("\n");
}

export function styleUsageCount(project: Project, id: string): number {
  const count = (node: DocNode): number =>
    (node.attrs?.styleId === id ? 1 : 0) +
    (node.marks || []).filter((mark) => mark.attrs?.styleId === id).length +
    (node.content || []).reduce((total, child) => total + count(child), 0);
  return (
    project.clips.reduce(
      (total, clip) =>
        total +
        count(clip.document) +
        clip.variants.reduce((n, variant) => n + count(variant.document), 0),
      0,
    ) +
    project.placements.reduce(
      (total, placement) =>
        total +
        (placement.frozenDocument ? count(placement.frozenDocument) : 0),
      0,
    )
  );
}
