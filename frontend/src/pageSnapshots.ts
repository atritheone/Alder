import { PAGE_GAP, type PageLayout } from "./pageFlow";

/** Copy the measured page geometry, rather than reflowing a text excerpt.
 * Only blocks intersecting a page are copied. A split paragraph/table keeps its
 * full layout and is clipped at the same boundary as the writing canvas.
 */
export function pageSnapshots(
  root: HTMLElement,
  layout: PageLayout,
  count: number,
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
    return wrapper.outerHTML;
  });
}
