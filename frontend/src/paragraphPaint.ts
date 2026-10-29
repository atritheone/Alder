import type { EditorView } from "prosemirror-view";
import type { FlowPage, PageLayout } from "./pageFlow";
import { documentCanvasWidth, pageFrame, pageAtY } from "./sectionLayout";
import { resolveStyles } from "./styleResolution";
import { paragraphAppearanceKeys } from "./paragraphAppearance";
import type { NamedStyle } from "./types";
import { pageInsets } from "./pageGeometry";

const clips = new WeakMap<Element, string>();
const painted = new WeakMap<EditorView, Element[]>();
const sheets = new WeakMap<EditorView, HTMLStyleElement>();
const styleSelectors = new WeakMap<NamedStyle[], string>();
let serial = 0;
/** Paint-only clipping. Pagination spacers belong to the continuous paragraph,
 * but its shading and vertical borders must never paint the page margins/gap.
 * Keep the clip outside the authored DOM and undo/clipboard representation. */
export function layoutParagraphPaint(
  view: EditorView,
  layout: PageLayout,
  pages: FlowPage[],
  styles?: NamedStyle[],
) {
  const rules: string[] = [];
  for (const old of painted.get(view) || []) clips.delete(old);
  const updated: Element[] = [];
  painted.set(view, updated);
  const canvas = view.dom.closest<HTMLElement>(".flow-canvas");
  if (!canvas || !pages.length) return;
  const origin = canvas.getBoundingClientRect();
  const scale = origin.width / documentCanvasWidth(view.state.doc, layout);
  if (!(scale > 0)) return;
  let sheet = sheets.get(view);
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
    `table,:is(p,h1,h2,h3,h4,h5,h6,pre)[style*="--alder-paragraph-paint"]${namedSelector ? "," + namedSelector : ""}`,
  );
  for (const element of candidates) {
    const rect = element.getBoundingClientRect();
    const top = (rect.top - origin.top) / scale,
      bottom = (rect.bottom - origin.top) / scale;
    const first = pageAtY(pages, top, layout),
      last = pageAtY(pages, bottom - 0.01, layout);
    if (
      first === last ||
      (!element.matches("table") &&
        getComputedStyle(element)
          .getPropertyValue("--alder-paragraph-paint")
          .trim() !== "1")
    )
      continue;
    const paths: string[] = [];
    const width = rect.width / scale;
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
      const header = pages[index].header;
      const source = header && view.nodeDOM(header.table);
      const repeated =
        source instanceof Element &&
        (source === element || source.contains(element))
          ? header!.height
          : 0;
      const start = Math.max(-bleed, frame.top + margin.top + repeated - top);
      const end = Math.min(
        bottom - top + bleed,
        frame.top + frame.layout.height - margin.bottom - top,
      );
      if (end > start)
        paths.push(
          `M ${-bleed} ${start} H ${width + bleed} V ${end} H ${-bleed} Z`,
        );
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
      let index = 1,
        previous = current.previousElementSibling;
      while (previous) {
        index++;
        previous = previous.previousElementSibling;
      }
      path.unshift(`:nth-child(${index})`);
      current = current.parentElement;
    }
    const clip = `path("${paths.join(" ")}")`;
    clips.set(element, clip);
    updated.push(element);
    rules.push(
      `[data-paragraph-paint-scope="${sheet.dataset.paragraphPaint}"] > ${path.join(" > ")}{clip-path:${clip};}`,
    );
  }
  if (sheet && sheet.textContent !== rules.join("\n"))
    sheet.textContent = rules.join("\n");
}
export function copyParagraphPaint(source: Element, target: HTMLElement) {
  const clip = clips.get(source);
  if (clip) target.style.clipPath = clip;
}
export function disposeParagraphPaint(view: EditorView) {
  for (const old of painted.get(view) || []) clips.delete(old);
  painted.delete(view);
  sheets.get(view)?.remove();
  sheets.delete(view);
  view.dom.removeAttribute("data-paragraph-paint-scope");
}
