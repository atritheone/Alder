import type { Node as PMNode } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import type { NamedStyle } from "./types";
import { resolveStyles } from "./styleResolution";

type ExactBlock = { pos: number; node: PMNode; runs: string[] };
type Presentation = {
  sheet: HTMLStyleElement;
  blocks: ExactBlock[];
  frame: number;
  signature: string;
  elements: HTMLElement[];
};
const presentations = new WeakMap<EditorView, Presentation>();
const painted = new WeakSet<Element>();
let identity = 0;
const inline = "span,strong,b,em,i,u,s,sub,sup,a,mark,code";

/** Keep exact leading's line boxes fixed while keeping each glyph on its
 * original baseline. Rules are outside the editable DOM and never authored. */
export function exactLeading(
  styles: () => NamedStyle[],
  enabled: () => boolean,
) {
  let previousDoc: PMNode | undefined, previousStyles: NamedStyle[] | undefined;
  let blocks: ExactBlock[] = [],
    decorations = DecorationSet.empty;
  const keys = new WeakMap<PMNode, string>();
  const index = (doc: PMNode) => {
    const definitions = styles();
    if (doc === previousDoc && definitions === previousStyles) return;
    previousDoc = doc;
    previousStyles = definitions;
    let resolved: ReturnType<typeof resolveStyles> = new Map();
    try {
      resolved = resolveStyles(definitions);
    } catch {
      /* Reported by the editor. */
    }
    blocks = [];
    const spans: Decoration[] = [];
    if (enabled())
      doc.descendants((node, pos) => {
        if (!node.isTextblock) return;
        const inherited = resolved.get(node.attrs.styleId);
        if (
          (node.attrs.lineSpacingMode ?? inherited?.lineSpacingMode) !== "exact"
        )
          return false;
        let key = keys.get(node);
        if (!key) {
          key = `e${++identity}`;
          keys.set(node, key);
        }
        const runs: string[] = [];
        node.forEach((child, offset) => {
          if (!child.isText) return;
          const run = `${key}-${offset}`;
          runs.push(run);
          spans.push(
            Decoration.inline(
              pos + offset + 1,
              pos + offset + 1 + child.nodeSize,
              { "data-exact-run": run },
            ),
          );
        });
        blocks.push({ pos, node, runs });
        return false;
      });
    decorations = DecorationSet.create(doc, spans);
  };
  return new Plugin({
    props: {
      decorations(state) {
        index(state.doc);
        return decorations;
      },
    },
    view(view) {
      const sheet = document.createElement("style");
      sheet.dataset.alderExactLeading = "";
      document.head.append(sheet);
      const state: Presentation = {
        sheet,
        blocks,
        frame: 0,
        signature: "",
        elements: [],
      };
      presentations.set(view, state);
      const schedule = () => {
        index(view.state.doc);
        state.blocks = blocks;
        cancelAnimationFrame(state.frame);
        state.frame = requestAnimationFrame(() => layoutExactLeading(view));
      };
      schedule();
      const observer = new MutationObserver((records) => {
        if (
          records.some((record) =>
            [...record.addedNodes, ...record.removedNodes].some(
              (node) =>
                node instanceof Element &&
                (node.hasAttribute("data-exact-run") ||
                  node.querySelector("[data-exact-run]")),
            ),
          )
        )
          schedule();
      });
      observer.observe(view.dom, { childList: true, subtree: true });
      return {
        update(_view, previous) {
          if (previous.doc !== view.state.doc || previousStyles !== styles())
            schedule();
        },
        destroy() {
          observer.disconnect();
          cancelAnimationFrame(state.frame);
          sheet.remove();
          presentations.delete(view);
        },
      };
    },
  });
}

export function layoutExactLeading(view: EditorView, force = false) {
  const state = presentations.get(view);
  if (!state || !view.dom.isConnected) return;
  if (!state.blocks.length) {
    state.sheet.textContent = "";
    state.signature = "";
    state.elements = [];
    return;
  }
  const targets: { element: HTMLElement; selector: string }[] = [];
  const seen = new Set<Element>();
  for (const block of state.blocks) {
    const parent = view.nodeDOM(block.pos) as HTMLElement | null;
    if (!parent) continue;
    for (const run of parent.querySelectorAll<HTMLElement>(
      "[data-exact-run]",
    )) {
      let selector = `[data-exact-run="${run.dataset.exactRun}"]`;
      let element: HTMLElement | null = run;
      while (element && element !== parent && element.matches(inline)) {
        if (!seen.has(element)) {
          targets.push({ element, selector });
          seen.add(element);
        }
        selector = `:is(${inline}):has(> ${selector})`;
        element = element.parentElement;
      }
    }
  }
  const font = (element: Element) => {
    const css = getComputedStyle(element);
    return `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
  };
  const signature = targets
    .map(
      ({ element, selector }) =>
        `${selector}|${font(element)}|${font(element.parentElement!)}`,
    )
    .join("\n");
  if (
    !force &&
    signature === state.signature &&
    targets.every(({ element }, i) => state.elements[i] === element)
  )
    return;
  // Read original vertical-align rather than a preceding normalization rule.
  state.sheet.textContent = "";
  const context = document.createElement("canvas").getContext("2d")!;
  const mids = new Map<string, number>();
  const middle = (value: string) => {
    if (!mids.has(value)) {
      context.font = value;
      const m = context.measureText("Mg");
      mids.set(value, (m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2);
    }
    return mids.get(value)!;
  };
  const rules = targets.map(({ element, selector }) => {
    const css = getComputedStyle(element),
      parent = getComputedStyle(element.parentElement!);
    const delta = middle(font(element.parentElement!)) - middle(font(element));
    const original = css.verticalAlign;
    const shift =
      original === "super"
        ? -parseFloat(parent.fontSize) * 0.33
        : original === "sub"
          ? parseFloat(parent.fontSize) * 0.2
          : original.endsWith("px")
            ? -parseFloat(original)
            : 0;
    painted.add(element);
    return `${selector}{line-height:0!important;vertical-align:${delta}px!important;position:relative;top:${delta + shift}px}`;
  });
  state.sheet.textContent = rules.join("\n");
  state.signature = signature;
  state.elements = targets.map((t) => t.element);
}

export function copyExactLeading(source: Element, target: HTMLElement) {
  if (!painted.has(source)) return;
  const css = getComputedStyle(source);
  for (const property of ["line-height", "vertical-align", "position", "top"])
    target.style.setProperty(property, css.getPropertyValue(property));
}
