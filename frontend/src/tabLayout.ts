import type { Node as PMNode } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { cssTabStops, nextTab } from "./tabStops";

type Block = { node: PMNode; pos: number; key: string; tabs: number[] };
type Layout = {
  blocks: Block[];
  sheet: HTMLStyleElement;
  rules: Map<string, CSSStyleRule>;
  measured: Map<string, string>;
  doc?: PMNode;
  frame: number;
};
const layouts = new WeakMap<EditorView, Layout>();
let nextId = 0;
export const tabLeaderCSS =
  ".alder-tab{position:relative}.alder-tab::after{content:'';position:absolute;left:0;right:0;top:var(--alder-tab-leader-y);height:1.3px;background-image:inherit;background-size:5px 1.3px;background-repeat:repeat-x;pointer-events:none}";

/** Literal tabs remain text. Layout styles live outside the editable DOM, so
 * measuring a tab never creates authored edits or mutation-observer reparses. */
export function tabLayout(enabled: () => boolean) {
  const keys = new WeakMap<PMNode, string>();
  let doc: PMNode | undefined,
    decorations = DecorationSet.empty,
    blocks: Block[] = [];
  const index = (current: PMNode) => {
    if (doc === current) return;
    doc = current;
    blocks = [];
    const spans: Decoration[] = [];
    if (enabled())
      current.descendants((node, pos) => {
        if (!node.isTextblock) return;
        if (
          (node.type.spec.code && node.attrs.tabStops == null) ||
          !node.textContent.includes("\t")
        )
          return false;
        let key = keys.get(node);
        if (!key) {
          key = `t${++nextId}`;
          keys.set(node, key);
        }
        const tabs: number[] = [];
        node.forEach((child, offset) => {
          if (!child.isText) return;
          for (const match of child.text!.matchAll(/\t/g)) {
            const at = offset + match.index!;
            tabs.push(at);
            spans.push(
              Decoration.inline(pos + 1 + at, pos + 2 + at, {
                class: "alder-tab",
                "data-alder-tab": `${key}-${at}`,
              }),
            );
          }
        });
        blocks.push({ node, pos, key, tabs });
        return false;
      });
    decorations = DecorationSet.create(current, spans);
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
      sheet.dataset.alderTabs = "";
      sheet.textContent = tabLeaderCSS;
      document.head.append(sheet);
      const state: Layout = {
        blocks,
        sheet,
        rules: new Map(),
        measured: new Map(),
        frame: 0,
      };
      layouts.set(view, state);
      const schedule = () => {
        index(view.state.doc);
        state.blocks = blocks;
        cancelAnimationFrame(state.frame);
        state.frame = requestAnimationFrame(() => layoutTabs(view));
      };
      schedule();
      return {
        update() {
          if (state.doc !== view.state.doc) schedule();
        },
        destroy() {
          cancelAnimationFrame(state.frame);
          sheet.remove();
          layouts.delete(view);
        },
      };
    },
  });
}

const leaders = {
  none: "none",
  dot: "radial-gradient(circle,currentColor 0.65px,transparent 0.9px)",
  dash: "linear-gradient(to right,currentColor 50%,transparent 50%)",
  line: "linear-gradient(currentColor,currentColor)",
};

export function layoutTabs(view: EditorView, invalidate = false) {
  const state = layouts.get(view);
  if (!state || !view.dom.isConnected || !state.sheet.sheet) return;
  const sheet = state.sheet.sheet;
  if (invalidate) state.measured.clear();
  // Page-spacer decoration updates can run before this plugin's scheduled pass.
  state.doc = view.state.doc;
  const active = new Set(
    state.blocks.flatMap((b) => b.tabs.map((at) => `${b.key}-${at}`)),
  );
  for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
    const rule = sheet.cssRules[i] as CSSStyleRule;
    const key = rule.selectorText?.match(/"([^"]+)"/)?.[1];
    if (key && !active.has(key)) {
      sheet.deleteRule(i);
      state.rules.delete(key);
    }
  }
  const activeBlocks = new Set(state.blocks.map((b) => b.key));
  for (const key of state.measured.keys())
    if (!activeBlocks.has(key)) state.measured.delete(key);
  for (const block of state.blocks) {
    const element = view.nodeDOM(block.pos) as HTMLElement | null;
    if (!element) continue;
    const css = getComputedStyle(element),
      rect = element.getBoundingClientRect();
    const scale = rect.width / element.offsetWidth;
    if (!Number.isFinite(scale) || scale <= 0) continue;
    const signature = [
      element.offsetWidth,
      css.font,
      css.letterSpacing,
      css.textIndent,
      css.getPropertyValue("--alder-tab-stops"),
    ].join("|");
    if (state.measured.get(block.key) === signature) continue;
    const contentsPage =
      element.closest("[data-document-contents]") &&
      block.node.lastChild?.attrs.referenceFormat === "page";
    const stops = contentsPage
      ? [
          {
            position:
              (element.clientWidth +
                (parseFloat(css.marginLeft) || 0) -
                (parseFloat(css.paddingRight) || 0)) *
              0.75,
            align: "right" as const,
            leader: "dot" as const,
          },
        ]
      : cssTabStops(css.getPropertyValue("--alder-tab-stops"));
    const tabs = new Map(
      [...element.querySelectorAll<HTMLElement>("[data-alder-tab]")].map(
        (e) => [e.dataset.alderTab!, e],
      ),
    );
    const alignmentRule = sheet.cssRules.length;
    sheet.insertRule(
      `:is(p,h1,h2,h3,h4,h5,h6):has([data-alder-tab^="${block.key}-"]){text-align:left!important}`,
      alignmentRule,
    );
    for (const at of block.tabs) {
      const key = `${block.key}-${at}`,
        tab = tabs.get(key);
      if (!tab) continue;
      let rule = state.rules.get(key);
      if (!rule) {
        const i = sheet.insertRule(
          `[data-alder-tab="${key}"]{display:inline-block;white-space:pre;tab-size:0;text-indent:0;width:0;background-size:0 0}`,
          sheet.cssRules.length,
        );
        rule = sheet.cssRules[i] as CSSStyleRule;
        state.rules.set(key, rule);
      }
      rule.style.width = "0px";
      const firstTop = tab.getBoundingClientRect().top;
      // Stops are measured from the text margin, before paragraph indentation.
      const x =
        ((tab.getBoundingClientRect().left - rect.left) / scale +
          (parseFloat(css.marginLeft) || 0)) *
        0.75;
      let width = 0,
        decimalWidth: number | undefined;
      let segmentEnd = block.node.content.size;
      block.node.forEach((child, offset) => {
        if (offset > at && child.type.name === "hard_break")
          segmentEnd = Math.min(segmentEnd, offset);
      });
      const canvas = document.createElement("canvas"),
        context = canvas.getContext("2d")!;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text = walker.currentNode as Text;
        if (text.parentElement?.closest(".ProseMirror-widget")) continue;
        const position = view.posAtDOM(text, 0) - block.pos - 1;
        if (position >= segmentEnd) break;
        if (position + text.length <= at + 1) continue;
        let value = text.data.slice(Math.max(0, at + 1 - position));
        const end = value.search(/[\t\n]/);
        if (end >= 0) value = value.slice(0, end);
        const font = getComputedStyle(text.parentElement!);
        // Computed `font` can be empty when Chromium cannot serialize all font
        // longhands. Canvas would silently keep its 10px sans-serif default.
        context.font = `${font.fontStyle} ${font.fontWeight} ${font.fontSize} ${font.fontFamily}`;
        context.fontKerning = "normal";
        const measure = (s: string) =>
          (context.measureText(s).width +
            (parseFloat(font.letterSpacing) || 0) * s.length) *
          0.75;
        const decimal = value.search(/[.,]/);
        if (decimalWidth == null && decimal >= 0)
          decimalWidth = width + measure(value.slice(0, decimal));
        width += measure(value);
        if (end >= 0) break;
      }
      let next = nextTab(stops, x, width, decimalWidth ?? width);
      rule.style.width = `${next.gap / 0.75}px`;
      if (tab.getBoundingClientRect().top > firstTop + scale * 2) {
        const wrappedX =
          ((tab.getBoundingClientRect().left - rect.left) / scale +
            (parseFloat(css.marginLeft) || 0)) *
          0.75;
        next = nextTab(stops, wrappedX, width, decimalWidth ?? width);
        rule.style.width = `${next.gap / 0.75}px`;
      }
      rule.style.backgroundImage = leaders[next.leader];
      const tabFont = getComputedStyle(tab);
      context.font = `${tabFont.fontStyle} ${tabFont.fontWeight} ${tabFont.fontSize} ${tabFont.fontFamily}`;
      const metrics = context.measureText("Mg");
      const baseline =
        (metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2;
      rule.style.setProperty(
        "--alder-tab-leader-y",
        `calc(50% + ${baseline - 1}px)`,
      );
    }
    sheet.deleteRule(alignmentRule);
    state.measured.set(block.key, signature);
  }
}
