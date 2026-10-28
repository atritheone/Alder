import { headingFormatting } from "./documentFormatting";
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
  "lineSpacing",
  "lineSpacingMode",
  "keepWithNext",
  "keepTogether",
  "widowOrphan",
  "pageBreakBefore",
  "spaceAfter",
  "spaceBefore",
  "color",
  "align",
  "leftIndent",
  "rightIndent",
  "firstLineIndent",
] as const;
const numericBounds: Record<string, [number, number]> = {
  fontSize: [6, 72],
  lineHeight: [0.8, 4],
  lineSpacing: [1, 144],
  spaceAfter: [0, 144],
  spaceBefore: [0, 144],
  leftIndent: [-144, 144],
  rightIndent: [-144, 144],
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
        [
          "keepWithNext",
          "keepTogether",
          "widowOrphan",
          "pageBreakBefore",
        ].includes(key) &&
        typeof value !== "boolean"
      )
        throw new Error(`“${style.name}” has an invalid paragraph flow value.`);
      else if (
        key === "lineSpacingMode" &&
        !["multiple", "exact", "atLeast"].includes(String(value))
      )
        throw new Error(`“${style.name}” has an invalid line spacing mode.`);
      else if (
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
  for (const [id, style] of byId) {
    visit(id);
    if (
      style.nextStyle &&
      (!byId.has(style.nextStyle) ||
        byId.get(style.nextStyle)?.kind === "character" ||
        style.kind === "character")
    )
      throw new Error(
        `“${style.name}” needs an existing paragraph style for its next paragraph.`,
      );
  }
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
    if (
      typeof style.lineSpacing === "number" &&
      style.lineSpacing >= 1 &&
      style.lineSpacing <= 144
    ) {
      if (style.lineSpacingMode === "exact")
        css.push(
          `line-height:${style.lineSpacing}pt;--alder-paragraph-leading:${style.lineSpacing}pt`,
        );
      if (style.lineSpacingMode === "atLeast")
        css.push(
          `line-height:max(1.2em,${style.lineSpacing}pt);--alder-paragraph-leading:max(1.2em,${style.lineSpacing}pt)`,
        );
    }
    if (style.lineSpacingMode === "multiple") {
      const leading =
        typeof style.lineHeight === "number" &&
        style.lineHeight >= 0.8 &&
        style.lineHeight <= 4
          ? style.lineHeight
          : "var(--page-leading,1.6)";
      css.push(`--alder-paragraph-leading:${leading};line-height:${leading}`);
    }
    if (style.keepWithNext != null)
      css.push(`break-after:${style.keepWithNext ? "avoid" : "auto"}`);
    if (style.keepTogether != null)
      css.push(`break-inside:${style.keepTogether ? "avoid" : "auto"}`);
    if (style.pageBreakBefore != null)
      css.push(`break-before:${style.pageBreakBefore ? "page" : "auto"}`);
    if (style.widowOrphan != null)
      css.push(
        `widows:${style.widowOrphan ? 2 : 1};orphans:${style.widowOrphan ? 2 : 1}`,
      );
    number("spaceAfter", "margin-bottom");
    number("spaceBefore", "margin-top");
    number("leftIndent", "margin-left");
    number("rightIndent", "margin-right");
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
  const headings = [1, 2, 3, 4, 5, 6]
    .map(
      (level) =>
        `${prefix} h${level}{${styleDeclarations(headingFormatting(level), "paragraph")}}`,
    )
    .join("\n");
  return (
    headings +
    `\n${prefix} :is(p,h1,h2,h3,h4,h5,h6,pre) span:not(.pagination-spacer){line-height:var(--alder-paragraph-leading,inherit)}\n` +
    [...resolveStyles(styles).values()]
      .map((style) => {
        const target =
          style.kind === "character" ? "span" : ":is(p,h1,h2,h3,h4,h5,h6,pre)";
        return `${prefix} ${target}[data-style="${cssString(style.id)}"]{${styleDeclarations(style, style.kind)}}`;
      })
      .join("\n")
  );
}

export function styleUsageCount(project: Project, id: string): number {
  const count = (node: DocNode): number =>
    (node.attrs?.styleId === id ? 1 : 0) +
    (node.marks || []).filter((mark) => mark.attrs?.styleId === id).length +
    (node.content || []).reduce((total, child) => total + count(child), 0);
  return (
    (project.book?.chapters.reduce(
      (n, chapter) => n + count(chapter.document),
      0,
    ) || 0) +
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

/** Replace every linked use atomically; reject inheritance cycles before editing. */
export function replaceProjectStyle(
  project: Project,
  removedId: string,
  replacementId: string,
): void {
  const removed = project.styles.find((style) => style.id === removedId);
  const replacement = project.styles.find(
    (style) => style.id === replacementId,
  );
  if (
    !removed ||
    !replacement ||
    removedId === replacementId ||
    (removed.kind || "paragraph") !== (replacement.kind || "paragraph")
  )
    throw new Error("Choose a different style of the same kind.");
  const styles = project.styles
    .filter((style) => style.id !== removedId)
    .map((style) => ({
      ...style,
      ...(style.basedOn === removedId ? { basedOn: replacementId } : {}),
      ...(style.nextStyle === removedId ? { nextStyle: replacementId } : {}),
    }));
  resolveStyles(styles);
  const visit = (node: DocNode) => {
    if (node.attrs?.styleId === removedId) node.attrs.styleId = replacementId;
    for (const mark of node.marks || [])
      if (mark.attrs?.styleId === removedId) mark.attrs.styleId = replacementId;
    for (const child of node.content || []) visit(child);
  };
  for (const chapter of project.book?.chapters || []) visit(chapter.document);
  for (const clip of project.clips) {
    visit(clip.document);
    for (const variant of clip.variants) visit(variant.document);
  }
  for (const placement of project.placements)
    if (placement.frozenDocument) visit(placement.frozenDocument);
  project.styles = styles;
}
