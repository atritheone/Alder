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
  rules: Map<string, { rule: CSSStyleRule; signature: string }>;
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
        // Plain runs already use their paragraph's exact line box. Wrapping
        // every fragment in a compensating span doubles the DOM when optional
        // hyphenation is active, without changing the baseline. Mixed marks,
        // tabs and objects still use the measured compensation below.
        let plain = true;
        node.forEach((child) => {
          if (
            child.type.name !== "hard_break" &&
            (!child.isText || child.marks.length || child.text?.includes("\t"))
          )
            plain = false;
        });
        if (plain) return false;
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
        rules: new Map(),
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
    state.rules.clear();
    return;
  }
  const targets: { element: HTMLElement; selector: string }[] = [];
  const seen = new Set<Element>();
  const selectors = new Set<string>();
  // Root nodeDOM lookups walk preceding siblings. Resolve ordinary body blocks
  // together, retaining nodeDOM only for nested stories.
  const rootElements = Array.from(view.dom.children).filter(
    (element) => !element.classList.contains("ProseMirror-widget"),
  );
  const roots = new Map<number, HTMLElement>();
  if (rootElements.length === view.state.doc.childCount)
    view.state.doc.forEach((_node, pos, index) =>
      roots.set(pos, rootElements[index] as HTMLElement),
    );
  for (const block of state.blocks) {
    const parent =
      roots.get(block.pos) || (view.nodeDOM(block.pos) as HTMLElement | null);
    if (!parent) continue;
    // Hyphenation splits one authored run into many DOM fragments. Their
    // selector and font are identical; one representative supplies the rule.
    for (const id of block.runs) {
      const run: HTMLElement | null = parent.querySelector<HTMLElement>(
        `[data-exact-run="${id}"]`,
      );
      if (!run) continue;
      let selector = `[data-exact-run="${run.dataset.exactRun}"]`;
      let path = selector;
      let element: HTMLElement | null = run;
      while (element && element !== parent && element.matches(inline)) {
        if (!seen.has(element)) {
          // Discretionary breaks and pagination can split one authored run
          // into hundreds of DOM fragments with the same font and selector.
          // Measure that style once, while retaining print paint on every
          // fragment. Duplicate rules made optional hyphenation quadratic.
          if (!selectors.has(selector)) {
            targets.push({ element, selector });
            selectors.add(selector);
          }
          painted.add(element);
          seen.add(element);
        }
        // :has() cannot be nested. Express deeper ancestors as a single
        // relative child chain, which also works with CSSOM insertRule.
        selector = `:is(${inline}):has(> ${path})`;
        path = `:is(${inline}) > ${path}`;
        element = element.parentElement;
      }
    }
  }
  const font = (element: Element) => {
    const css = getComputedStyle(element);
    return `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
  };
  const signatures = targets.map(
    ({ element, selector }) =>
      `${selector}|${font(element)}|${font(element.parentElement!)}`,
  );
  const signature = signatures.join("\n");
  if (
    !force &&
    signature === state.signature &&
    targets.every(({ element }, i) => state.elements[i] === element)
  )
    return;
  // Only remove the changed runs' rules before measuring their original
  // baseline. Replacing the complete stylesheet invalidates every glyph in
  // a long document, even when just one paragraph changed.
  const sheet = state.sheet.sheet!;
  const desired = new Map(
    targets.map((target, index) => [target.selector, signatures[index]]),
  );
  const removed: CSSStyleRule[] = [];
  for (const [selector, existing] of state.rules) {
    if (force || desired.get(selector) !== existing.signature) {
      removed.push(existing.rule);
      state.rules.delete(selector);
    }
  }
  const indices = removed
    .map((rule) => Array.from(sheet.cssRules).indexOf(rule))
    .filter((i) => i >= 0)
    .sort((a, b) => b - a);
  for (const index of indices) sheet.deleteRule(index);
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
  const rules = targets.flatMap(({ element, selector }, index) => {
    if (state.rules.has(selector)) return [];
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
    return [
      {
        selector,
        signature: signatures[index],
        css: `${selector}{line-height:0!important;vertical-align:${delta}px!important;position:relative;top:${delta + shift}px}`,
      },
    ];
  });
  for (const { selector, signature, css } of rules) {
    const at = sheet.insertRule(css, sheet.cssRules.length);
    state.rules.set(selector, {
      rule: sheet.cssRules[at] as CSSStyleRule,
      signature,
    });
  }
  state.signature = signature;
  state.elements = targets.map((t) => t.element);
}

export function copyExactLeading(source: Element, target: HTMLElement) {
  // Later fragments inherit the same rule without an exhaustive measurement
  // scan. Recognise those fragments when freezing a publication copy.
  if (
    !painted.has(source) &&
    !source.hasAttribute("data-exact-run") &&
    !(source.matches(inline) && source.querySelector("[data-exact-run]"))
  )
    return;
  const css = getComputedStyle(source);
  for (const property of ["line-height", "vertical-align", "position", "top"])
    target.style.setProperty(property, css.getPropertyValue(property));
}
