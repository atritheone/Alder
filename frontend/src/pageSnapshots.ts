import { PAGE_GAP, type PageLayout } from "./pageFlow";
import type { EditorView } from "prosemirror-view";
import { documentUnits, type ArrangementUnit } from "./arrangementUnits";

/** Copy the measured page geometry, rather than reflowing a text excerpt.
 * Only blocks intersecting a page are copied. A split paragraph/table keeps its
 * full layout and is clipped at the same boundary as the writing canvas.
 */
export function pageSnapshots(
  root: HTMLElement,
  layout: PageLayout,
  count: number,
  view?: EditorView,
  gap?: ArrangementUnit,
  originalUnits?: ArrangementUnit[],
): string[] {
  const canvas = root.closest<HTMLElement>(".flow-canvas")!;
  const origin = canvas.getBoundingClientRect();
  const scale = origin.width / layout.width;
  const scope = root.closest<HTMLElement>("[data-alder-editor]")!.dataset
    .alderEditor!;
  const typography = getComputedStyle(root);
  const blocks = Array.from(root.children, (element) => {
    const rect = element.getBoundingClientRect();
    return {
      element,
      top: (rect.top - origin.top) / scale,
      bottom: (rect.bottom - origin.top) / scale,
      left: (rect.left - origin.left) / scale,
      width: rect.width / scale,
      height: rect.height / scale,
    };
  });
  const measuredUnits =
    originalUnits || (view ? documentUnits(view.state.doc) : []);
  // A dropped fragment can join an unfinished sentence. Its insertion gap
  // still needs its own geometry even if sentence segmentation now merges it.
  if (
    gap &&
    !measuredUnits.some(
      (unit) =>
        unit.kind === gap.kind && unit.from === gap.from && unit.to === gap.to,
    )
  )
    measuredUnits.push(gap);
  const units = view
    ? measuredUnits.map((unit) => {
        let rects: DOMRect[];
        if (unit.kind === "paragraph") {
          const blocks: DOMRect[] = [];
          view.state.doc.nodesBetween(unit.from, unit.to, (node, pos) => {
            if (!node.isTextblock) return;
            const element = view.nodeDOM(pos) as HTMLElement | null;
            if (element) blocks.push(element.getBoundingClientRect());
            return false;
          });
          const left = Math.min(...blocks.map((r) => r.left));
          const top = Math.min(...blocks.map((r) => r.top));
          rects = blocks.length
            ? [
                new DOMRect(
                  left,
                  top,
                  Math.max(...blocks.map((r) => r.right)) - left,
                  Math.max(...blocks.map((r) => r.bottom)) - top,
                ),
              ]
            : [];
        } else {
          const start = view.domAtPos(unit.from),
            end = view.domAtPos(unit.to);
          const range = document.createRange();
          range.setStart(start.node, start.offset);
          range.setEnd(end.node, end.offset);
          // Measure text fragments only. A whole DOM range also includes the
          // invisible pagination spacers and would outline blank page margins.
          const ancestor = range.commonAncestorContainer;
          const textNodes: Node[] = [];
          if (ancestor.nodeType === Node.TEXT_NODE) textNodes.push(ancestor);
          else {
            const walker = document.createTreeWalker(
              ancestor,
              NodeFilter.SHOW_TEXT,
            );
            while (walker.nextNode())
              if (range.intersectsNode(walker.currentNode))
                textNodes.push(walker.currentNode);
          }
          rects = textNodes.flatMap((node) => {
            if (
              node.parentElement?.closest(
                ".structure-marker, .pagination-spacer",
              )
            )
              return [];
            const fragment = document.createRange();
            fragment.setStart(node, node === start.node ? start.offset : 0);
            fragment.setEnd(
              node,
              node === end.node ? end.offset : node.textContent!.length,
            );
            return Array.from(fragment.getClientRects()).filter(
              (rect) => rect.width > 0 && rect.height > 0,
            );
          });
          // Marks and spelling decorations split text into separate DOM nodes.
          // Join their rectangles into one outline per visual sentence line.
          const lines: DOMRect[] = [];
          for (const rect of rects) {
            const at = lines.findIndex(
              (line) =>
                Math.min(line.bottom, rect.bottom) -
                  Math.max(line.top, rect.top) >
                Math.min(line.height, rect.height) * 0.5,
            );
            if (at < 0) lines.push(rect);
            else {
              const line = lines[at];
              const left = Math.min(line.left, rect.left),
                top = Math.min(line.top, rect.top);
              lines[at] = new DOMRect(
                left,
                top,
                Math.max(line.right, rect.right) - left,
                Math.max(line.bottom, rect.bottom) - top,
              );
            }
          }
          rects = lines;
        }
        return { unit, rects };
      })
    : [];
  return Array.from({ length: count }, (_, page) => {
    const top = page * (layout.height + PAGE_GAP);
    const wrapper = document.createElement("div");
    wrapper.className = "page-flow page-snapshot";
    wrapper.dataset.alderEditor = scope;
    wrapper.style.cssText = `width:${layout.width}px;height:${layout.height}px;--page-width:${layout.width}px;--page-height:${layout.height}px;--page-margin:${layout.margin}px;--page-leading:${layout.lineHeight};`;
    const documentCopy = document.createElement("div");
    documentCopy.className = "ProseMirror";
    documentCopy.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;min-height:0;padding:0;";
    for (const property of [
      "font-family",
      "font-size",
      "font-weight",
      "font-style",
      "color",
      "white-space",
      "overflow-wrap",
      "word-break",
      "tab-size",
      "direction",
    ])
      documentCopy.style.setProperty(
        property,
        typography.getPropertyValue(property),
      );
    // Keep the unitless leading: headings and large text inherit the multiplier,
    // not the normal paragraph's computed pixel line height.
    documentCopy.style.lineHeight = String(layout.lineHeight);
    for (const block of blocks) {
      if (block.bottom <= top || block.top >= top + layout.height) continue;
      const copy = block.element.cloneNode(true) as HTMLElement;
      if (view) {
        // Retain document positions on snapshot text, so a sentence preview
        // can reflow just its destination paragraph without rebuilding an editor.
        const originals = document.createTreeWalker(
          block.element,
          NodeFilter.SHOW_TEXT,
        );
        const copies = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
        const pairs: [Node, Node][] = [];
        while (originals.nextNode() && copies.nextNode())
          pairs.push([originals.currentNode, copies.currentNode]);
        for (const [original, cloned] of pairs) {
          if (
            original.parentElement?.closest(
              ".structure-marker,.pagination-spacer,.write-caret",
            )
          )
            continue;
          const span = document.createElement("span");
          span.dataset.arrangeFrom = String(view.posAtDOM(original, 0));
          span.dataset.arrangeTo = String(
            view.posAtDOM(original, original.textContent!.length),
          );
          cloned.parentNode!.replaceChild(span, cloned);
          span.append(cloned);
        }
        const originalElements = [
          block.element,
          ...block.element.querySelectorAll("p,h1,h2,h3,h4,h5,h6,pre"),
        ];
        const copyElements = [
          copy,
          ...copy.querySelectorAll("p,h1,h2,h3,h4,h5,h6,pre"),
        ];
        originalElements.forEach((element, i) => {
          if (element.matches("p,h1,h2,h3,h4,h5,h6,pre"))
            copyElements[i].setAttribute(
              "data-textblock-from",
              String(view.posAtDOM(element, 0)),
            );
        });
      }
      copy.style.setProperty("position", "absolute");
      copy.style.setProperty("top", `${block.top - top}px`);
      copy.style.setProperty("left", `${block.left}px`);
      copy.style.setProperty("width", `${block.width}px`);
      copy.style.setProperty("height", `${block.height}px`);
      copy.style.setProperty("margin", "0");
      copy.style.setProperty("box-sizing", "border-box");
      for (const node of [copy, ...copy.querySelectorAll<HTMLElement>("*")]) {
        for (const attribute of [
          "id",
          "contenteditable",
          "tabindex",
          "aria-label",
          "data-help",
        ])
          node.removeAttribute(attribute);
        if (node.tagName === "A") node.setAttribute("tabindex", "-1");
        node.classList.remove(
          "reading-word",
          "selectedCell",
          "ProseMirror-selectednode",
          "annotation",
          "annotation-repetition",
          "structure-whitespace",
        );
      }
      copy
        .querySelectorAll(".structure-marker, .write-caret")
        .forEach((node) => node.remove());
      documentCopy.append(copy);
    }
    wrapper.append(documentCopy);
    for (const { unit, rects } of units) {
      const sameGap =
        gap?.kind === unit.kind && gap.from === unit.from && gap.to === unit.to;
      const layer = document.createElement("div");
      layer.className = `arrangement-unit unit-${unit.kind}${sameGap ? " is-unit-gap" : ""}${!unit.text.trim() ? " is-empty" : ""}`;
      layer.dataset.unit = JSON.stringify(unit);
      layer.dataset.unitKey = `${unit.kind}:${unit.from}:${unit.to}`;
      layer.setAttribute(
        "aria-label",
        `${unit.kind === "paragraph" ? "Paragraph" : "Sentence"}: ${unit.text.slice(0, 80) || "Empty paragraph"}`,
      );
      for (const rect of rects) {
        const inset = unit.kind === "paragraph" ? 9 : 1;
        const verticalInset = unit.kind === "paragraph" ? 3 : 1;
        const y = (rect.top - origin.top) / scale - top;
        const bottom = Math.min(
          layout.height - layout.margin + 2,
          (rect.bottom - origin.top) / scale - top,
        );
        const start = Math.max(layout.margin - 2, y);
        if (bottom <= start) continue;
        const box = document.createElement("span");
        box.className = "unit-outline";
        box.style.cssText = `left:${(rect.left - origin.left) / scale - inset}px;top:${start - verticalInset}px;width:${rect.width / scale + inset * 2}px;height:${bottom - start + verticalInset * 2}px;`;
        layer.append(box);
      }
      if (layer.childElementCount) wrapper.append(layer);
    }
    return wrapper.outerHTML;
  });
}
