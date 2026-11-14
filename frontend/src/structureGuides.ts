import { Plugin, NodeSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import type { FlowPage, PageLayout } from "./pageFlow";
import type { NamedStyle } from "./types";
import { resolveStyles } from "./styleResolution";
import { pageFrame } from "./sectionLayout";
import { mirroredPageLayout, mirrorShiftToPage } from "./mirroredMargins";
import { pageInsets } from "./pageGeometry";
import { columnParagraphRects } from "./columnLayout";

type Options = {
  enabled: boolean;
  layout?: PageLayout;
  pages: FlowPage[];
  styles?: NamedStyle[];
};
const painters = new WeakMap<EditorView, () => void>();
export function refreshStructureGuides(view: EditorView) {
  painters.get(view)?.();
}
const ns = "http://www.w3.org/2000/svg";

/** Measured, non-interactive paint outside ProseMirror. Never modify authored
 * nodes, their styles or line boxes to explain their geometry. */
export function structureGuides(options: () => Options) {
  return new Plugin({
    view(view) {
      const layer = document.createElementNS(ns, "svg");
      layer.classList.add("document-structure-layer");
      layer.setAttribute("aria-hidden", "true");
      layer.setAttribute("focusable", "false");
      let frame = 0,
        signature = "";
      let definitions: NamedStyle[] | undefined;
      let styles: ReturnType<typeof resolveStyles> = new Map();
      const paint = () => {
        const settings = options();
        if (!settings.enabled) {
          layer.remove();
          return;
        }
        const root =
          view.dom.closest<HTMLElement>(".flow-canvas") ||
          view.dom.parentElement;
        if (
          !root ||
          !root.offsetWidth ||
          !view.dom.getBoundingClientRect().width
        )
          return;
        if (layer.parentElement !== root) root.append(layer);
        const origin = root.getBoundingClientRect(),
          scale = origin.width / root.offsetWidth;
        if (!(scale > 0)) return;
        if (definitions !== settings.styles) {
          definitions = settings.styles;
          try {
            styles = resolveStyles(definitions || []);
          } catch {
            styles = new Map();
          }
        }
        const local = (rect: DOMRect) => ({
          x: (rect.left - origin.left) / scale,
          y: (rect.top - origin.top) / scale,
          width: rect.width / scale,
          height: rect.height / scale,
        });
        const bodies = settings.layout
          ? settings.pages.map((_, index) => {
              const f = pageFrame(settings.pages, index, settings.layout!);
              const l = mirroredPageLayout(f.layout, index),
                m = pageInsets(l);
              return {
                x: f.left + m.left,
                y: f.top + m.top,
                width: l.width - m.left - m.right,
                height: l.height - m.top - m.bottom,
              };
            })
          : [];
        const shapes: string[] = [];
        const value = (n: number) => Number(n.toFixed(2));
        const path = (d: string, kind: string, clip?: number) =>
          shapes.push(
            `<path class="${kind}" d="${d}"${clip == null ? "" : ` clip-path="url(#${id}-${clip})"`}/>`,
          );
        const line = (
          x: number,
          y: number,
          toX: number,
          toY: number,
          kind: string,
          clip?: number,
        ) =>
          path(
            `M${value(x)} ${value(y)}L${value(toX)} ${value(toY)}`,
            kind,
            clip,
          );
        const rect = (
          x: number,
          y: number,
          width: number,
          height: number,
          kind: string,
          clip?: number,
        ) =>
          shapes.push(
            `<rect class="${kind}" x="${value(x)}" y="${value(y)}" width="${value(Math.max(0, width))}" height="${value(Math.max(0, height))}"${clip == null ? "" : ` clip-path="url(#${id}-${clip})"`}/>`,
          );
        const symbol = (x: number, y: number, text: string, kind: string) =>
          shapes.push(
            `<text class="${kind}" x="${value(x)}" y="${value(y)}">${text}</text>`,
          );
        const columns = view.dom.hasAttribute("data-column-layout");
        const viewport = view.dom
          .closest(".editor-scroll")
          ?.getBoundingClientRect();
        const selected = view.state.selection;
        const elements = [...view.dom.children].filter(element => !element.classList.contains("ProseMirror-widget"));
        const roots = new Map<number, Element>();
        if (elements.length === view.state.doc.childCount)
          view.state.doc.forEach((_node, pos, index) => roots.set(pos, elements[index]));
        view.state.doc.descendants((node, pos) => {
          if (node.isText) return false;
          const element = roots.get(pos) || view.nodeDOM(pos);
          if (!(element instanceof Element)) return;
          // Bound expensive style/fragment reads to the visible neighbourhood.
          // Column fragments can project beyond their parent's source box.
          const bounds = element.getBoundingClientRect();
          if (
            !columns &&
            viewport &&
            (bounds.bottom < viewport.top - 300 ||
              bounds.top > viewport.bottom + 300)
          )
            return false;
          if (
            node.isTextblock &&
            ["paragraph", "heading", "code_block"].includes(node.type.name)
          ) {
            const css = getComputedStyle(element);
            const inherited = styles.get(node.attrs.styleId);
            const attr = (key: string) =>
              node.attrs[key] ??
              (inherited as Record<string, unknown> | undefined)?.[key];
            const active =
              selected.from >= pos && selected.from < pos + node.nodeSize;
            const kind = `structure-paragraph-cue${active ? " structure-active" : ""}`;
            const before = parseFloat(css.marginTop) || 0,
              after = parseFloat(css.marginBottom) || 0;
            const indent = parseFloat(css.textIndent) || 0;
            const left = parseFloat(css.marginLeft) || 0,
              right = parseFloat(css.marginRight) || 0;
            const keep = css.breakAfter === "avoid" || !!attr("keepWithNext");
            const together =
              css.breakInside === "avoid" || !!attr("keepTogether");
            const breaks =
              css.breakBefore === "page" || !!attr("pageBreakBefore");
            if (!node.content.size && !keep && !together && !breaks)
              return false;
            const boxes = columns
              ? columnParagraphRects(view, node, pos) || []
              : [bounds];
            for (const box of boxes) {
              const r = local(box);
              const parts = bodies.length
                ? bodies.flatMap((body, index) => {
                    const top = Math.max(body.y, r.y),
                      bottom = Math.min(body.y + body.height, r.y + r.height);
                    if (bottom <= top) return [];
                    const dx =
                      !columns && settings.layout?.mirrorMargins
                        ? mirrorShiftToPage(view, pos + 1, index)
                        : 0;
                    return [
                      {
                        ...r,
                        x: r.x + dx,
                        y: top,
                        height: bottom - top,
                        clip: index,
                      },
                    ];
                  })
                : [{ ...r, clip: undefined }];
              for (const p of parts) {
                const x = p.x - 8,
                  top = p.y,
                  bottom = p.y + p.height;
                const first = Math.abs(top - r.y) < 1,
                  last = Math.abs(bottom - r.y - r.height) < 1;
                // Side brackets show actual before/after spacing, without tinting prose.
                if (first && before > 0.5)
                  path(
                    `M${value(x + 3)} ${value(top - before)}h-3V${value(top)}h3`,
                    kind,
                    p.clip,
                  );
                if (last && after > 0.5)
                  path(
                    `M${value(x + 3)} ${value(bottom)}h-3v${value(after)}h3`,
                    kind,
                    p.clip,
                  );
                if (first && Math.abs(indent) > 0.5)
                  path(
                    `M${value(p.x)} ${value(top - 3)}h${value(indent)}v3`,
                    kind,
                    p.clip,
                  );
                if (first && Math.abs(left) > 0.5)
                  line(p.x - left, top - 5, p.x, top - 5, kind, p.clip);
                if (first && Math.abs(right) > 0.5)
                  line(
                    p.x + p.width,
                    top - 5,
                    p.x + p.width + right,
                    top - 5,
                    kind,
                    p.clip,
                  );
                if (together)
                  path(
                    `M${value(x - 3)} ${value(top)}h-3V${value(bottom)}h3`,
                    kind,
                    p.clip,
                  );
                if (keep && last) {
                  // Paired links identify a keep-with-next relationship; the line
                  // stops at the page boundary when the next block is elsewhere.
                  path(
                    `M${value(x)} ${value(bottom - 4)}v${value(after + 8)}m-2 -6h4m-4 3h4`,
                    kind,
                    p.clip,
                  );
                }
                if (breaks && first) symbol(x - 6, top + 10, "↡", kind);
              }
            }
          }
          if (
            ["page_break", "column_break", "section_break"].includes(
              node.type.name,
            )
          ) {
            const r = local(element.getBoundingClientRect());
            const y = r.y + Math.min(r.height / 2, 8);
            const glyph =
              node.type.name === "section_break"
                ? "§"
                : node.type.name === "column_break"
                  ? "↦"
                  : "↡";
            line(r.x, y, r.x + Math.max(24, r.width), y, "structure-break-cue");
            symbol(r.x - 15, y + 4, glyph, "structure-break-cue");
            return false;
          }
          if (
            [
              "text_box",
              "image",
              "inline_image",
              "document_field",
              "cross_reference",
              "form_field",
              "form_block",
              "shape",
              "equation",
              "table_cell",
              "table_header",
            ].includes(node.type.name)
          ) {
            const object =
              node.type.name === "image"
                ? element.querySelector("img") || element
                : element;
            const css = getComputedStyle(object);
            const cell = ["table_cell", "table_header"].includes(
              node.type.name,
            );
            const invisibleBorder = ["Top", "Right", "Bottom", "Left"].every(
              (edge) =>
                parseFloat(
                  css.getPropertyValue(`border-${edge.toLowerCase()}-width`),
                ) === 0 ||
                ["transparent", "rgba(0, 0, 0, 0)"].includes(
                  css.getPropertyValue(`border-${edge.toLowerCase()}-color`),
                ),
            );
            if (!cell || invisibleBorder)
              for (const box of object.getClientRects()) {
                const r = local(box);
                if (!bodies.length)
                  rect(r.x, r.y, r.width, r.height, "structure-object-cue");
                else
                  bodies.forEach((body, index) => {
                    if (r.y + r.height < body.y || r.y > body.y + body.height)
                      return;
                    const dx =
                      !columns && settings.layout?.mirrorMargins
                        ? mirrorShiftToPage(view, pos, index)
                        : 0;
                    rect(
                      r.x + dx,
                      r.y,
                      r.width,
                      r.height,
                      "structure-object-cue",
                      index,
                    );
                  });
              }
            if (
              ["left", "right"].includes(node.attrs.wrap) &&
              object.parentElement
            ) {
              const r = local(object.getBoundingClientRect());
              const anchor = local(
                object.parentElement.getBoundingClientRect(),
              );
              symbol(
                anchor.x - 16,
                anchor.y + 12,
                "⚓",
                "structure-paragraph-cue",
              );
              if (selected instanceof NodeSelection && selected.from === pos)
                path(
                  `M${value(anchor.x - 7)} ${value(anchor.y + 14)}H${value(anchor.x - 16)}V${value(Math.min(anchor.y, r.y) - 5)}H${value(r.x - 4)}V${value(r.y + 6)}H${value(r.x)}`,
                  "structure-anchor-link",
                );
            }
          }
        });
        const width = root.offsetWidth;
        const height = Math.max(
          root.clientHeight,
          (view.dom.getBoundingClientRect().bottom - origin.top) / scale,
        );
        const clips = bodies
          .map(
            (body, index) =>
              `<clipPath id="${id}-${index}"><rect x="${value(body.x - 20)}" y="${value(body.y)}" width="${value(body.width + 40)}" height="${value(body.height)}"/></clipPath>`,
          )
          .join("");
        const next = `<defs>${clips}</defs>${shapes.join("")}`;
        layer.setAttribute("width", String(width));
        layer.setAttribute("height", String(height));
        if (next !== signature) {
          layer.innerHTML = next;
          signature = next;
        }
      };
      const id = `alder-structure-${++serial}`;
      const schedule = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(paint);
      };
      painters.set(view, schedule);
      const resize = new ResizeObserver(schedule);
      resize.observe(view.dom);
      const viewport = view.dom.closest(".editor-scroll");
      if (viewport) resize.observe(viewport);
      viewport?.addEventListener("scroll", schedule, { passive: true });
      view.dom.addEventListener("load", schedule, true);
      document.fonts.addEventListener("loadingdone", schedule);
      schedule();
      return {
        update(current, previous) {
          if (
            current.state.doc !== previous.doc ||
            !current.state.selection.eq(previous.selection) ||
            definitions !== options().styles
          )
            schedule();
        },
        destroy() {
          cancelAnimationFrame(frame);
          resize.disconnect();
          viewport?.removeEventListener("scroll", schedule);
          view.dom.removeEventListener("load", schedule, true);
          document.fonts.removeEventListener("loadingdone", schedule);
          painters.delete(view);
          layer.remove();
        },
      };
    },
  });
}
let serial = 0;
