import { documentCanvasWidth, pageFrame } from "./sectionLayout";
import {pageInsets} from './pageGeometry';
import { freezePrintedHyphens } from "./hyphenation";
import { copyProjectedPaint } from "./paragraphPaint";
import { columnRulesHTML } from "./columns";
import type { EditorView } from "prosemirror-view";
import type { FlowPage, PageLayout } from "./pageFlow";
import { tableHeaderHTML } from "./tablePageHeaders";
import { preparePublicationSemantics } from "./publicationSemantics";
import { freezeFormFields } from "./formFields";
import { pageFurnitureDOM } from "./pageFurniture";
import { lineNumbersHTML } from "./lineNumberLayout";
import { assertRunningMatterFits } from "./runningMatter";
import { copyExactLeading } from "./exactLeading";
import { tabLeaderCSS } from "./tabLayout";
import { freezeTablesInCopy } from "./tableSnapshotLayout";
import { wrappingExclusions, freezeImageWrapping } from "./imageWrapping";
import { overflowingWordRows, measuredTextBoxes } from "./wordRowLayout";
import {
  pageTextSegments,
  physicalPageAtPosition,
  type PageRange,
} from "./pageRanges";

export type PublicationPage = {
  from: number;
  to: number;
  width: number;
  height: number;
  html: string;
  fragments?: readonly PageRange[];
};
export type PagePublication = {
  mixedNoteGeometry?: boolean;
  overflowingRows?: string[];
  textBoxes?: Record<string, { width: number; height: number }>;
  version: 1;
  sourceIdentity: string;
  sourceDocument: string;
  pages: PublicationPage[];
};

const paintProperties = [
  "clip-path",
  "outline-style",
  "outline-width",
  "outline-color",
  "outline-offset",
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
  "background-image",
  "background-size",
  "background-repeat",
  "background-position",
  "--alder-tab-leader-y",
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

/** Freeze the editing page map as a printable browser document.
 * No paragraph is reflowed by a second typesetter. Invisible prefix/suffix text
 * retains its line geometry but is excluded from PDF drawing/extraction.
 * Note fragments follow the body in reading order while retaining their reserved
 * page position. Repeated furniture is excluded from the semantic tree. */
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
  const bookmarkNames = new Map<string, string>();
  const notePositions = new Map<string, number>();
  const noteDestinations = new Set<string>();
  const noteGeometry=new Map<string,string>();let mixedNoteGeometry=false;
  view.state.doc.descendants((node, pos) => {
    if(node.type.name==='equation'){
      const index=physicalPageAtPosition(pages,pos);
      if(index===null)throw new Error('An equation has not been placed on a page.');
      const frame=pageFrame(pages,index,layout),insets=pageInsets(frame.layout),element=view.nodeDOM(pos) as HTMLElement;
      const rect=element.getBoundingClientRect(),columns=frame.layout.columns;
      const count=columns?.count||1,gap=(columns?.gapMm||0)*96/25.4;
      let width=(frame.layout.width-insets.left-insets.right-gap*(count-1))/count;
      const cell=element.closest('td,th');
      if(cell){const css=getComputedStyle(cell);width=Math.min(width,cell.getBoundingClientRect().width/scale-parseFloat(css.paddingLeft||'0')-parseFloat(css.paddingRight||'0'));}
      if(rect.width/scale>width+1 || rect.height/scale>frame.layout.height-insets.top-insets.bottom+1)
        throw new Error('An equation is too large for its page, column or table cell. Shorten it, reduce the paragraph font size or use a larger page before publishing.');
      return false;
    }
    if (node.type.name === "document_note") {
      notePositions.set(node.attrs.blockId, pos);
      bookmarkNames.set(
        node.attrs.blockId,
        "note-reference_" + node.attrs.blockId,
      );
    }
    if (node.type.name === "index_entry")
      bookmarkNames.set(node.attrs.blockId, "index_" + node.attrs.blockId);
    if (node.type.name === "bookmark") {
      bookmarkNames.set(node.attrs.blockId, node.attrs.name);
      bookmarkNames.set(node.attrs.name, node.attrs.name);
    }
  });
  const checkedRunningMatter = new Set<string>();
  const wrappedImages = wrappingExclusions(view.dom, scale);
  const copies = pages.map((page, index) => {
    const frame = pageFrame(pages, index, layout),
      current = frame.layout,
      pageTop = frame.top;
    if (current.runningMatter) {
      const key = JSON.stringify([
        current.width,
        current.height,
        current.margin,
        current.margins,
        current.runningMatter,
        current.runningStyles,
        current.runningHeadings,
        current.fontFamily,
      ]);
      if (!checkedRunningMatter.has(key)) {
        assertRunningMatterFits(
          current,
          view.state.schema,
          current.runningStyles,
        );
        checkedRunningMatter.add(key);
      }
    }
    const sheet = document.createElement("section");
    sheet.className = "publication-sheet";
    sheet.setAttribute("role", "presentation");
    sheet.style.cssText = `position:relative;width:${current.width}px;height:${current.height}px;overflow:hidden;break-after:page;box-sizing:border-box;background:white;`;
    for (const property of paintProperties)
      sheet.style.setProperty(property, rootStyle.getPropertyValue(property));
    // Screen editor properties must not alter the sheet's geometry.
    sheet.style.margin = "0";
    sheet.style.padding = "0";
    sheet.style.border = "0";
    sheet.style.display = "block";
    const paint = copyProjectedPaint(view, frame);
    if (paint) sheet.append(paint);
    if (page.columnRules) {
      const rules = document.createElement("div");
      rules.innerHTML = columnRulesHTML(page);
      sheet.append(rules);
    }
    if (page.lineNumbers?.length) {
      const numbers = document.createElement("div");
      numbers.innerHTML = lineNumbersHTML(page);
      sheet.append(numbers);
    }
    if (page.from !== page.to || page.noteHTML) {
      const furniture = pageFurnitureDOM(
        current,
        index,
        view.state.schema,
        pages.length,
      );
      furniture.setAttribute("aria-hidden", "true");
      sheet.prepend(furniture);
    }
    if (page.columnHeaders) {
      const header = document.createElement("div");
      header.innerHTML = page.columnHeaders.join("");
      header.setAttribute("aria-hidden", "true");
      sheet.append(header);
    }
    if (page.header) {
      const header = document.createElement("div");
      header.innerHTML = tableHeaderHTML(view, current, page.header, index);
      header.setAttribute("aria-hidden", "true");
      sheet.append(header);
    }
    for (const { element, rect } of blocks) {
      if (
        (rect.bottom - origin.top) / scale <= pageTop ||
        (rect.top - origin.top) / scale >= pageTop + current.height
      )
        continue;
      const copy = element.cloneNode(true) as HTMLElement;
      copy.dataset.publicationBlock = "true";
      const originals = [
        element,
        ...element.querySelectorAll<HTMLElement>("*"),
      ];
      const clones = [copy, ...copy.querySelectorAll<HTMLElement>("*")];
      originals.forEach((original, at) => {
        const clone = clones[at];
        // MathML lays out its own operators and arguments. Painting its tokens
        // as ordinary HTML spans destroys fractions, roots and script sizing.
        if(original.parentElement?.closest('[data-equation]'))return;
        const style = getComputedStyle(original);
        if (original.matches(".discretionary-hyphen"))
          clone.dataset.printHyphen = String(
            original.getBoundingClientRect().width / scale > 0.5,
          );
        for (const property of paintProperties)
          clone.style.setProperty(property, style.getPropertyValue(property));
        copyExactLeading(original, clone);
        if(original.matches('[data-equation]')){
          const box=original.getBoundingClientRect();
          const owner=physicalPageAtPosition(pages,view.posAtDOM(original,0));
          if(owner!==index){clone.style.visibility='hidden';clone.setAttribute('aria-hidden','true');}
          else {clone.dataset.publicationTop=String((box.top-origin.top)/scale-pageTop);clone.dataset.publicationLeft=String((box.left-origin.left)/scale);}
        }
        if (original.classList.contains("ProseMirror-selectednode")) {
          clone.style.outline = "none";
          clone.classList.remove("ProseMirror-selectednode");
        }
        // Preserve authored column/image dimensions, which auto layout cannot infer
        // after separating a spanning table over independently clipped pages.
        if (original.matches("table,col,th,td,img,.alder-tab")) {
          clone.style.width = `${original.getBoundingClientRect().width / scale}px`;
          if (original.matches("img"))
            clone.style.height = `${original.getBoundingClientRect().height / scale}px`;
        }
        if (original.matches("table"))
          clone.dataset.publicationTable = String(
            view.posAtDOM(original, 0) - 1,
          );
        if (
          original.matches("img") &&
          physicalPageAtPosition(pages, view.posAtDOM(original, 0)) !== index
        ) {
          clone.style.visibility = "hidden";
          clone.setAttribute("aria-hidden", "true");
        }
        for (const attribute of [...clone.attributes])
          if (
            attribute.name.startsWith("on") ||
            [
              "id",
              "contenteditable",
              "tabindex",
              "data-document-citation",
              "data-document-bibliography",
            ].includes(attribute.name)
          )
            clone.removeAttribute(attribute.name);
        if (original.matches("[data-document-bookmark]")) {
          const position = view.posAtDOM(original, 0);
          // A spanning paragraph is copied onto several sheets. Only its owning
          // sheet receives the destination, never an invisible earlier copy.
          if (physicalPageAtPosition(pages, position) === index)
            clone.id = original.getAttribute("data-document-bookmark")!;
        }
        if (original.matches("[data-index-id]")) {
          const position = view.posAtDOM(original, 0),
            resolved = view.state.doc.resolve(position);
          if (
            physicalPageAtPosition(
              pages,
              resolved.parentOffset > 0 ? position - 1 : position,
            ) === index
          )
            clone.id = "index_" + original.getAttribute("data-index-id");
        }
        if (original.matches('a[href^="#"]')) {
          const name = bookmarkNames.get(
            original.getAttribute("href")!.slice(1),
          );
          if (name) clone.setAttribute("href", `#${name}`);
          else clone.removeAttribute("href");
        }
        if (original.matches(".pagination-spacer")) {
          clone.style.height = `${original.getBoundingClientRect().height / scale}px`;
          clone.style.visibility = "hidden";
        }
        if (
          original.matches(
            ".structure-marker,.write-caret,.reading-highlight,.ProseMirror-separator",
          )
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
            ".pagination-spacer,.structure-marker,.discretionary-hyphen,[data-equation]",
          )
        )
          continue;
        const value = original.textContent || "";
        const start = view.posAtDOM(original, 0);
        const fragment = document.createDocumentFragment();
        for (const {
          from: visibleStart,
          to: visibleEnd,
          visible,
        } of pageTextSegments(page, start, value.length)) {
          const text = value.slice(visibleStart, visibleEnd);
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
      for (const reference of copy.querySelectorAll<HTMLElement>(
        "[data-cross-reference]",
      )) {
        const name = bookmarkNames.get(reference.dataset.crossReference!);
        if (!name || reference.dataset.referenceUnresolved === "true") continue;
        const link = document.createElement("a");
        link.href = `#${name}`;
        link.style.cssText = "color:inherit;text-decoration:inherit";
        link.append(...reference.childNodes);
        reference.append(link);
      }
      for (const note of copy.querySelectorAll<HTMLElement>("[data-note-id]")) {
        note.textContent = note.dataset.noteNumber || "1";
        if (
          physicalPageAtPosition(
            pages,
            notePositions.get(note.dataset.noteId!) || 0,
          ) !== index
        )
          note.style.visibility = "hidden";
        else {
          note.id = "note-reference_" + note.dataset.noteId;
          const link = document.createElement("a");
          link.href = "#note-body_" + note.dataset.noteId;
          link.setAttribute("role", "doc-noteref");
          link.style.cssText = "color:inherit;text-decoration:inherit";
          link.textContent = note.textContent;
          note.replaceChildren(link);
        }
        note.removeAttribute("data-document-note");
      }
      freezeTablesInCopy(element, copy, scale);
      freezeFormFields(element, copy, scale);
      freezeImageWrapping(element, copy, scale, wrappedImages);
      copy.style.position = "absolute";
      copy.style.top = `${(rect.top - origin.top) / scale - pageTop}px`;
      copy.style.left = `${(rect.left - origin.left) / scale - frame.left}px`;
      copy.style.width = `${rect.width / scale}px`;
      copy.style.height = `${rect.height / scale}px`;
      copy.style.margin = "0";
      sheet.append(copy);
    }
    if (page.noteHTML) {
      const notes = document.createElement("div");
      notes.innerHTML = page.noteHTML;
      for (const fragment of notes.querySelectorAll<HTMLElement>(
        "[data-note-fragment]",
      )) {
        const id = fragment.dataset.noteFragment!;
        if(fragment.closest('[data-footnotes]')){
          const inset=pageInsets(current),geometry=JSON.stringify([current.width,current.height,inset.top,inset.bottom,inset.left+inset.right]);
          if(noteGeometry.has(id)&&noteGeometry.get(id)!==geometry)mixedNoteGeometry=true;
          else noteGeometry.set(id,geometry);
        }
        fragment.setAttribute("role", "note");
        if (!noteDestinations.has(id)) {
          noteDestinations.add(id);
          fragment.id = "note-body_" + id;
        }
      }
      sheet.append(notes);
    }
    preparePublicationSemantics(sheet);
    freezePrintedHyphens(sheet);
    return {
      from: page.from,
      to: page.to,
      ...(page.fragments ? { fragments: page.fragments } : {}),
      width: current.width,
      height: current.height,
      html: sheet.outerHTML,
    };
  });
  return {
    version: 1,
    mixedNoteGeometry,
    sourceIdentity,
    sourceDocument: JSON.stringify(view.state.doc.toJSON()),
    overflowingRows: [
      ...new Set([
        ...overflowingWordRows(view, layout, pages),
        ...pages.flatMap((page) => page.overflowingNoteRows || []),
      ]),
    ],
    textBoxes: measuredTextBoxes(view, layout, pages),
    pages: copies,
  };
}

export function publicationHTML(publication: PagePublication) {
  let mathFonts='';
  for(const sheet of document.styleSheets){
    try{for(const rule of sheet.cssRules)if(rule instanceof CSSFontFaceRule && rule.style.fontFamily.replace(/["']/g,'')==='Alder Math'){
      mathFonts+=rule.cssText.replace(/url\(["']?([^"')]+)["']?\)/g,(_match,url)=>`url("${new URL(url,sheet.href||location.href).href}")`);
    }}catch{/* Cross-origin styles cannot supply a local publication font. */}
  }
  const styles =
    publication.pages
      .map(
        (page, i) =>
          `@page alder${i}{size:${page.width}px ${page.height}px;margin:0}.publication-sheet:nth-child(${i + 1}){page:alder${i}}`,
      )
      .join("") + tabLeaderCSS + mathFonts + `.document-equation math{font-family:"Alder Math",math}.equation-description{display:none}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: file: alder:; style-src 'unsafe-inline'; font-src file: alder:"><style>${styles}html,body{margin:0;padding:0}*{box-sizing:border-box}.publication-sheet{contain:strict;break-inside:avoid}.publication-sheet:last-child{break-after:auto}</style></head><body>${publication.pages.map((page) => page.html).join("")}</body></html>`;
}
