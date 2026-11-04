import type { Node as PMNode } from "prosemirror-model";
import type { NamedStyle } from "./types";
import { resolveStyles } from "./styleResolution";
import { paragraphAppearanceKeys } from "./paragraphAppearance";

const textBlocks = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "pre"]);

const emptyStyles: NamedStyle[] = [];
const paintChecks = new WeakMap<NamedStyle[], (node: PMNode) => boolean>();
/** Plain manuscripts have no paragraph paint to clip. Check immutable model
 * subtrees before touching DOM geometry; complex containers use the full path. */
export function hasParagraphPaint(doc: PMNode, styles: NamedStyle[] = emptyStyles) {
  const definitions = styles.length ? styles : emptyStyles;
  let check = paintChecks.get(definitions);
  if (!check) {
    const cache = new WeakMap<PMNode, boolean>();
    let styled = new Set<string>();
    try {
      styled = new Set([...resolveStyles(definitions).values()]
        .filter(style => paragraphAppearanceKeys.some(key => style[key] != null))
        .map(style => style.id));
    } catch { return true; }
    check = (node) => {
      const cached = cache.get(node);
      if (cached !== undefined) return cached;
      const painted = node.type.name === "doc"
        ? node.content.content.some(child => check!(child))
        : !["paragraph", "heading", "code_block"].includes(node.type.name) ||
          paragraphAppearanceKeys.some(key => node.attrs[key] != null) || styled.has(node.attrs.styleId);
      cache.set(node, painted);
      return painted;
    };
    paintChecks.set(definitions, check);
  }
  return check(doc);
}

/** Paragraph interiors contain inline ink, not independent page paint. Walking
 * block containers avoids visiting every word/highlight/hyphen widget on edits. */
export function paragraphPaintCandidates(root: HTMLElement, selector: string) {
  const result: HTMLElement[] = [];
  const walk = (parent: Element) => {
    for (let child = parent.firstElementChild; child; child = child.nextElementSibling) {
      if (child.classList.contains("ProseMirror-widget")) continue;
      if (child.matches(selector)) result.push(child as HTMLElement);
      if (!textBlocks.has(child.localName)) walk(child);
    }
  };
  walk(root);
  return result;
}
