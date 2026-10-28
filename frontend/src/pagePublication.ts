import { documentCanvasWidth, pageFrame } from "./sectionLayout";
import type { EditorView } from "prosemirror-view";
import type { FlowPage, PageLayout } from "./pageFlow";
import { tableHeaderHTML } from "./tablePageHeaders";
import { pageFurnitureDOM } from "./pageFurniture";

export type PublicationPage = {
  from: number;
  to: number;
  width: number;
  height: number;
  html: string;
};
export type PagePublication = {
  version: 1;
  sourceIdentity: string;
  sourceDocument: string;
  pages: PublicationPage[];
};

const paintProperties = [
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-variant",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-align",
  "text-indent",
  "text-transform",
  "text-decoration",
  "vertical-align",
  "white-space",
  "overflow-wrap",
  "word-break",
  "direction",
  "unicode-bidi",
  "tab-size",
  "color",
  "background-color",
  "display",
  "box-sizing",
  "border-collapse",
  "border-spacing",
  "table-layout",
  "list-style-type",
  "list-style-position",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  ...["top", "right", "bottom", "left"].flatMap((edge) =>
    ["width", "style", "color"].map((property) => `border-${edge}-${property}`),
  ),
];

/** Prototype bridge from the editing page map to a printable browser document.
 * No paragraph is reflowed by a second typesetter. Invisible prefix/suffix text
 * retains its line geometry but is excluded from PDF drawing/extraction.
 * Flowing footnotes and accessibility tagging are not implemented. */
export function capturePagePublication(
  view: EditorView,
  layout: PageLayout,
  pages: FlowPage[],
  sourceIdentity: string,
): PagePublication {
  const canvas = view.dom.closest<HTMLElement>(".flow-canvas");
  if (!canvas || !pages.length)
    throw new Error("The document has not been paginated.");
  const origin = canvas.getBoundingClientRect();
  const scale = origin.width / documentCanvasWidth(view.state.doc, layout);
  if (!Number.isFinite(scale) || scale <= 0)
    throw new Error("The page geometry is unavailable.");
  const blocks = [...view.dom.children].map((element) => ({
    element,
    rect: element.getBoundingClientRect(),
  }));
  const rootStyle = getComputedStyle(view.dom);
  const copies = pages.map((page, index) => {
    const frame = pageFrame(pages, index, layout),
      current = frame.layout,
      pageTop = frame.top;
    const sheet = document.createElement("section");
    sheet.className = "publication-sheet";
    sheet.setAttribute("aria-label", `Page ${index + 1}`);
    sheet.style.cssText = `position:relative;width:${current.width}px;height:${current.height}px;overflow:hidden;break-after:page;box-sizing:border-box;background:white;`;
    for (const property of paintProperties)
      sheet.style.setProperty(property, rootStyle.getPropertyValue(property));
    // Screen editor properties must not alter the sheet's geometry.
    sheet.style.margin = "0";
    sheet.style.padding = "0";
    sheet.style.border = "0";
    sheet.style.display = "block";
    if (page.from !== page.to) sheet.append(pageFurnitureDOM(current, index));
    if (page.header) {
      const header = document.createElement("div");
      header.innerHTML = tableHeaderHTML(view, current, page.header);
      sheet.append(header);
    }
    for (const { element, rect } of blocks) {
      if (
        (rect.bottom - origin.top) / scale <= pageTop ||
        (rect.top - origin.top) / scale >= pageTop + current.height
      )
        continue;
      const copy = element.cloneNode(true) as HTMLElement;
      const originals = [
        element,
        ...element.querySelectorAll<HTMLElement>("*"),
      ];
      const clones = [copy, ...copy.querySelectorAll<HTMLElement>("*")];
      originals.forEach((original, at) => {
        const clone = clones[at];
        const style = getComputedStyle(original);
        for (const property of paintProperties)
          clone.style.setProperty(property, style.getPropertyValue(property));
        // Preserve authored column/image dimensions, which auto layout cannot infer
        // after separating a spanning table over independently clipped pages.
        if (original.matches("table,col,th,td,img")) {
          clone.style.width = `${original.getBoundingClientRect().width / scale}px`;
          if (original.matches("img"))
            clone.style.height = `${original.getBoundingClientRect().height / scale}px`;
        }
        for (const attribute of [...clone.attributes])
          if (
            attribute.name.startsWith("on") ||
            ["id", "contenteditable", "tabindex"].includes(attribute.name)
          )
            clone.removeAttribute(attribute.name);
        if (original.matches(".pagination-spacer")) {
          clone.style.height = `${original.getBoundingClientRect().height / scale}px`;
          clone.style.visibility = "hidden";
        }
        if (
          original.matches(".structure-marker,.write-caret,.reading-highlight")
        )
          clone.style.display = "none";
      });
      const originalText = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
      );
      const cloneText = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
      const pairs: [Node, Node][] = [];
      while (originalText.nextNode() && cloneText.nextNode())
        pairs.push([originalText.currentNode, cloneText.currentNode]);
      for (const [original, clone] of pairs) {
        if (
          original.parentElement?.closest(
            ".pagination-spacer,.structure-marker",
          )
        )
          continue;
        const value = original.textContent || "";
        const start = view.posAtDOM(original, 0);
        const visibleStart = Math.max(
          0,
          Math.min(value.length, page.from - start),
        );
        const visibleEnd = Math.max(
          visibleStart,
          Math.min(value.length, page.to - start),
        );
        const fragment = document.createDocumentFragment();
        for (const [text, visible] of [
          [value.slice(0, visibleStart), false],
          [value.slice(visibleStart, visibleEnd), true],
          [value.slice(visibleEnd), false],
        ] as const) {
          if (!text) continue;
          const span = document.createElement("span");
          span.textContent = text;
          if (!visible) {
            span.style.visibility = "hidden";
            span.setAttribute("aria-hidden", "true");
          } else {
            const range = document.createRange();
            range.setStart(original, visibleStart);
            range.setEnd(original, visibleEnd);
            const first = [...range.getClientRects()].find(
              (rect) => rect.width > 0,
            );
            if (first) {
              span.dataset.publicationTop = String(
                (first.top - origin.top) / scale - pageTop,
              );
              span.dataset.publicationLeft = String(
                (first.left - origin.left) / scale,
              );
            }
          }
          fragment.append(span);
        }
        clone.parentNode!.replaceChild(fragment, clone);
      }
      copy.style.position = "absolute";
      copy.style.top = `${(rect.top - origin.top) / scale - pageTop}px`;
      copy.style.left = `${(rect.left - origin.left) / scale - frame.left}px`;
      copy.style.width = `${rect.width / scale}px`;
      copy.style.height = `${rect.height / scale}px`;
      copy.style.margin = "0";
      sheet.append(copy);
    }
    return {
      from: page.from,
      to: page.to,
      width: current.width,
      height: current.height,
      html: sheet.outerHTML,
    };
  });
  return {
    version: 1,
    sourceIdentity,
    sourceDocument: JSON.stringify(view.state.doc.toJSON()),
    pages: copies,
  };
}

export function publicationHTML(publication: PagePublication) {
  const styles = publication.pages
    .map(
      (page, i) =>
        `@page alder${i}{size:${page.width}px ${page.height}px;margin:0}.publication-sheet:nth-child(${i + 1}){page:alder${i}}`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: file: alder:; style-src 'unsafe-inline'; font-src file: alder:"><style>${styles}html,body{margin:0;padding:0}*{box-sizing:border-box}.publication-sheet{contain:strict;break-inside:avoid}.publication-sheet:last-child{break-after:auto}</style></head><body>${publication.pages.map((page) => page.html).join("")}</body></html>`;
}
