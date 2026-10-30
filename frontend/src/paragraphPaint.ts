import type { EditorView } from "prosemirror-view";
import type { FlowPage, PageLayout } from "./pageFlow";
import { documentCanvasWidth, pageFrame, pageAtY } from "./sectionLayout";
import { resolveStyles } from "./styleResolution";
import { paragraphAppearanceKeys } from "./paragraphAppearance";
import type { NamedStyle } from "./types";
import { pageInsets } from "./pageGeometry";
import { mirrorShiftToPage } from "./mirroredMargins";

const clips = new WeakMap<Element, string>();
const painted = new WeakMap<EditorView, Element[]>();
const sheets = new WeakMap<EditorView, HTMLStyleElement>();
const styleSelectors = new WeakMap<NamedStyle[], string>();
let serial = 0;
const projectedPaint = new WeakMap<EditorView, HTMLElement>();
const projectedPages = new WeakMap<EditorView, Map<number, HTMLElement[]>>();
const projectedElements = new WeakSet<Element>();
const originalPaint = new WeakMap<Element, Record<string, string>>();
export function originalPaintProperty(element: Element, property: string) {
  return originalPaint.get(element)?.[property];
}
/** Paint-only clipping. Pagination spacers belong to the continuous paragraph,
 * but its shading and vertical borders must never paint the page margins/gap.
 * Keep the clip outside the authored DOM and undo/clipboard representation. */
export function layoutParagraphPaint(
  view: EditorView,
  layout: PageLayout,
  pages: FlowPage[],
  styles?: NamedStyle[],
  projectColumns = false,
) {
  const rules: string[] = [];
  for (const old of painted.get(view) || []) {
    clips.delete(old);
    projectedElements.delete(old);
    originalPaint.delete(old);
  }
  const updated: Element[] = [];
  painted.set(view, updated);
  const canvas = view.dom.closest<HTMLElement>(".flow-canvas");
  if (!canvas || !pages.length) return;
  const origin = canvas.getBoundingClientRect();
  const scale = origin.width / documentCanvasWidth(view.state.doc, layout);
  if (!(scale > 0)) return;
  let sheet = sheets.get(view);
  projectedPaint.get(view)?.remove();
  projectedPaint.delete(view);
  // Restore authored paint while reading it for horizontal page projection.
  if ((layout.mirrorMargins || projectColumns) && sheet) sheet.textContent = "";
  const overlay = document.createElement("div");
  const pagePaint = new Map<number, HTMLElement[]>();
  projectedPages.set(view, pagePaint);
  overlay.style.cssText = "position:absolute;inset:0;pointer-events:none";
  overlay.setAttribute("aria-hidden", "true");
  let namedSelector = styles && styleSelectors.get(styles);
  if (styles && namedSelector === undefined) {
    try {
      namedSelector = [...resolveStyles(styles).values()]
        .filter(
          (style) =>
            style.kind === "paragraph" &&
            paragraphAppearanceKeys.some((key) => style[key] != null),
        )
        .map(
          (style) =>
            `:is(p,h1,h2,h3,h4,h5,h6,pre)[data-style="${CSS.escape(style.id)}"]`,
        )
        .join(",");
    } catch {
      namedSelector = "";
    }
    styleSelectors.set(styles, namedSelector);
  }
  const candidates = view.dom.querySelectorAll<HTMLElement>(
    `table,blockquote${layout.mirrorMargins || projectColumns ? ",tr:not(.pagination-spacer)>td,tr:not(.pagination-spacer)>th" : ""},:is(p,h1,h2,h3,h4,h5,h6,pre)[style*="--alder-paragraph-paint"]${namedSelector ? "," + namedSelector : ""}`,
  );
  const tableEdges = new WeakMap<
    HTMLTableElement,
    { top: number; bottom: number }
  >();
  const childIndexes = new WeakMap<Element,Map<Element,number>>();
  for (const element of candidates) {
    const rect = element.getBoundingClientRect();
    const top = (rect.top - origin.top) / scale,
      bottom = (rect.bottom - origin.top) / scale;
    const first = pageAtY(pages, top, layout),
      last = pageAtY(pages, bottom - 0.01, layout);
    const cell = element instanceof HTMLTableCellElement;
    if (
      (!cell && first === last) ||
      (!cell &&
        !element.matches("table,blockquote") &&
        getComputedStyle(element)
          .getPropertyValue("--alder-paragraph-paint")
          .trim() !== "1")
    )
      continue;
    const paths: string[] = [];
    const width = rect.width / scale;
    const projected = (layout.mirrorMargins || projectColumns) && !element.matches("table");
    if (projected) {
      projectedElements.add(element);
      const css = getComputedStyle(element);
      originalPaint.set(
        element,
        Object.fromEntries(
          [
            "background-color",
            "outline-color",
            ...["top", "right", "bottom", "left"].map(
              (edge) => `border-${edge}-color`,
            ),
          ].map((property) => [property, css.getPropertyValue(property)]),
        ),
      );
    }
    const sourcePosition = layout.mirrorMargins ? view.posAtDOM(element, 0) : 0;
    // Collapsed table borders paint half outside the table's border box.
    // Retain that paint on the real first/last edge, while page margins and
    // continuation gaps remain clipped to the physical body boundaries.
    let bleed = 0;
    if (element instanceof HTMLTableElement) {
      const rows = [...element.rows].filter(
        (row) => !row.classList.contains("pagination-spacer"),
      );
      const cells = [rows[0], rows.at(-1)].flatMap((row) =>
        row ? [...row.cells] : [],
      );
      for (const cell of cells) {
        const style = getComputedStyle(cell);
        for (const side of ["Top", "Right", "Bottom", "Left"])
          bleed = Math.max(
            bleed,
            (parseFloat(
              style.getPropertyValue(`border-${side.toLowerCase()}-width`),
            ) || 0) /
              2 +
              0.1,
          );
      }
    }
    for (let index = first; index <= last; index++) {
      const frame = pageFrame(pages, index, layout),
        margin = pageInsets(frame.layout);
      if (pages[index].from === pages[index].to) continue;
      const repeated =Math.max(0,...(pages[index].header||[]).map(header=>{
        const source=view.nodeDOM(header.table);
        return source instanceof Element&&(source===element||source.contains(element))?(header.offset||0)+header.height:0;
      }));
      const start = Math.max(-bleed, frame.top + margin.top + repeated - top);
      const end = Math.min(
        bottom - top + bleed,
        frame.top + (pages[index].columnHeight==null?frame.layout.height-margin.bottom:margin.top+pages[index].columnHeight!) - top,
      );
      const shift = layout.mirrorMargins
        ? mirrorShiftToPage(view, sourcePosition, index, first)
        : 0;
      if (end > start) {
        paths.push(
          `M ${shift - bleed} ${start} H ${shift + width + bleed} V ${end} H ${shift - bleed} Z`,
        );
        if (projected) {
          const css = getComputedStyle(element),
            paint = document.createElement("div");
          paint.style.cssText = `position:absolute;left:${(rect.left - origin.left) / scale + shift}px;top:${top}px;width:${width}px;height:${bottom - top}px;clip-path:inset(${Math.max(0, start)}px 0 ${Math.max(0, bottom - top - end)}px 0);pointer-events:none`;
          for (const property of [
            "background-color",
            "outline-color",
            "outline-style",
            "outline-width",
            "outline-offset",
          ])
            paint.style.setProperty(property, css.getPropertyValue(property));
          if (element.matches("blockquote")) {
            paint.style.boxSizing = "border-box";
            for (const edge of ["top", "right", "bottom", "left"])
              for (const property of ["width", "style", "color"])
                paint.style.setProperty(
                  `border-${edge}-${property}`,
                  css.getPropertyValue(`border-${edge}-${property}`),
                );
          }
          if (cell) {
            const table = element.closest("table")!;
            let edges = tableEdges.get(table);
            if (!edges) {
              const cells = [...table.rows]
                .filter((row) => !row.classList.contains("pagination-spacer"))
                .flatMap((row) => [...row.cells]);
              const rects = cells.map((cell) => cell.getBoundingClientRect());
              edges = {
                top: Math.min(...rects.map((rect) => rect.top)),
                bottom: Math.max(...rects.map((rect) => rect.bottom)),
              };
              tableEdges.set(table, edges);
            }
            const shadows: string[] = [];
            for (const [edge, x, y] of [
              ["top", 0, 1],
              ["right", -1, 0],
              ["bottom", 0, -1],
              ["left", 1, 0],
            ] as const) {
              const line =
                parseFloat(css.getPropertyValue(`border-${edge}-width`)) || 0;
              const outer =
                edge === "left" || edge === "right"
                  ? ![...element.parentElement!.children].some(
                      (other) =>
                        other !== element &&
                        Math.abs(
                          (other.getBoundingClientRect()[
                            edge === "left" ? "right" : "left"
                          ] -
                            rect[edge]) /
                            scale,
                        ) < 1,
                    )
                  : Math.abs(rect[edge] - edges[edge]) / scale < 1;
              if (line)
                shadows.push(
                  `inset ${x * line * (outer ? 1 : 0.5)}px ${y * line * (outer ? 1 : 0.5)}px 0 ${css.getPropertyValue(`border-${edge}-color`)}`,
                );
            }
            paint.style.boxShadow = shadows.join(",");
          }
          overlay.append(paint);
          const fragments = pagePaint.get(frame.top) || [];
          fragments.push(paint);
          pagePaint.set(frame.top, fragments);
        }
      }
    }
    if (!sheet) {
      sheet = document.createElement("style");
      sheet.dataset.paragraphPaint = String(++serial);
      view.dom.setAttribute(
        "data-paragraph-paint-scope",
        sheet.dataset.paragraphPaint,
      );
      document.head.append(sheet);
      sheets.set(view, sheet);
    }
    const path: string[] = [];
    let current: Element | null = element;
    while (current && current !== view.dom) {
      const parent=current.parentElement!;
      let indexes=childIndexes.get(parent);
      if(!indexes){indexes=new Map([...parent.children].map((element,index)=>[element,index+1]));childIndexes.set(parent,indexes);}
      const index=indexes.get(current)!;
      path.unshift(`:nth-child(${index})`);
      current = current.parentElement;
    }
    const clip = projectColumns ? 'none' : `path("${paths.join(" ")}")`;
    clips.set(element, clip);
    updated.push(element);
    rules.push(
      `[data-paragraph-paint-scope="${sheet.dataset.paragraphPaint}"] > ${path.join(" > ")}{clip-path:${clip};${projected ? "background-color:transparent!important;outline-color:transparent!important;" : ""}${projected && (cell || element.matches("blockquote")) ? "border-color:transparent!important;" : ""}}`,
    );
  }
  if (sheet && sheet.textContent !== rules.join("\n"))
    sheet.textContent = rules.join("\n");
  if (overlay.childElementCount) {
    canvas.insertBefore(overlay, view.dom.parentElement);
    projectedPaint.set(view, overlay);
  }
}
/** Move frozen paint from measured flow regions into physical columns. */
export function projectColumnPaint(view:EditorView,regions:{top:number;pageTop:number;x:number;y:number}[]) {
  const current=projectedPages.get(view);if(!current)return;
  const next=new Map<number,HTMLElement[]>();
  for(const region of regions){
    const items=current.get(region.top)||[];
    for(const item of items){item.style.left=`${parseFloat(item.style.left)+region.x}px`;item.style.top=`${parseFloat(item.style.top)+region.y}px`;}
    next.set(region.pageTop,[...(next.get(region.pageTop)||[]),...items]);
  }
  projectedPages.set(view,next);
}
export function copyProjectedPaint(
  view: EditorView,
  frame: { top: number; left: number },
) {
  const source = projectedPaint.get(view);
  if (!source) return null;
  const copy = source.cloneNode(false) as HTMLElement;
  for (const paint of projectedPages.get(view)?.get(frame.top) || [])
    copy.append(paint.cloneNode(true));
  copy.style.left = `${-frame.left}px`;
  copy.style.top = `${-frame.top}px`;
  return copy;
}
export function copyParagraphPaint(source: Element, target: HTMLElement) {
  const clip = clips.get(source);
  if (clip) target.style.clipPath = clip;
  if (projectedElements.has(source)) {
    target.style.backgroundColor = "transparent";
    target.style.outlineColor = "transparent";
    if (source.matches("td,th,blockquote"))
      target.style.borderColor = "transparent";
  }
}
export function disposeParagraphPaint(view: EditorView) {
  projectedPaint.get(view)?.remove();
  projectedPaint.delete(view);
  projectedPages.delete(view);
  for (const old of painted.get(view) || []) clips.delete(old);
  painted.delete(view);
  sheets.get(view)?.remove();
  sheets.delete(view);
  view.dom.removeAttribute("data-paragraph-paint-scope");
}
