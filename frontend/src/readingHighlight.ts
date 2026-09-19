import type { Node as PMNode } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { projectedRange, projectText } from "./textProjection";

type ReadingRange = { start: number; end: number };
type WordBox = { left: number; right: number; top: number; height: number };

/**
 * A timed ink handover: the spoken word is fully covered at every animation
 * frame. Only the outer edge and departing ink move, never the text or caret.
 */
export function readingHighlight(
  currentRange: () => ReadingRange | null | undefined,
  visible: () => boolean,
) {
  let cache: {
    doc: PMNode;
    start: number;
    end: number;
    from: number;
    to: number;
    decorations: DecorationSet;
  } | null = null;
  return new Plugin({
    props: {
      decorations(state) {
        const range = currentRange();
        if (!range) {
          cache = null;
          return DecorationSet.empty;
        }
        if (
          cache?.doc === state.doc &&
          cache.start === range.start &&
          cache.end === range.end
        )
          return cache.decorations;
        try {
          const { from, to } = projectedRange(
            state.doc,
            range.start,
            range.end,
          );
          cache = {
            doc: state.doc,
            ...range,
            from,
            to,
            decorations:
              to > from
                ? DecorationSet.create(state.doc, [
                    Decoration.inline(from, to, { class: "reading-word" }),
                  ])
                : DecorationSet.empty,
          };
          return cache.decorations;
        } catch {
          cache = null;
          return DecorationSet.empty;
        }
      },
    },
    view(view) {
      const host = view.dom.parentElement!;
      host.classList.add("reading-highlight-host");
      const ink = document.createElement("span");
      const release = document.createElement("span");
      ink.className = "reading-ink";
      release.className = "reading-ink-release";
      for (const layer of [release, ink])
        layer.setAttribute("aria-hidden", "true");
      // Measure fractional UI/page zoom against the actual positioning origin.
      const basis = document.createElement("span");
      basis.setAttribute("aria-hidden", "true");
      basis.style.cssText =
        "position:absolute;left:0;top:0;width:100px;height:100px;visibility:hidden;pointer-events:none;";
      host.append(release, ink, basis);
      const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
      let arrival: Animation | undefined;
      let departure: Animation | undefined;
      let previous: {
        box: WordBox;
        end: number;
        time: number;
        doc: PMNode;
      } | null = null;
      let last = cache;
      let wasVisible = false;
      const clear = () => {
        arrival?.cancel();
        departure?.cancel();
        arrival = departure = undefined;
        ink.style.opacity = "0";
        host.classList.remove("reading-ink-active");
      };
      const reset = () => {
        clear();
        previous = null;
      };
      const viewport = host.closest<HTMLElement>(".editor-scroll");
      const resize = new ResizeObserver(reset);
      resize.observe(host);
      viewport?.addEventListener("scroll", reset, { passive: true });
      document.fonts.addEventListener("loadingdone", reset);
      motion.addEventListener("change", reset);
      const update = () => {
        const next = cache;
        const isVisible = visible();
        if (next === last && isVisible === wasVisible) return;
        const edited = previous && next && previous.doc !== next.doc;
        last = next;
        wasVisible = isVisible;
        if (!isVisible || edited || (next && next.to <= next.from)) reset();
        // Silence clears the marker immediately, but a short timing gap must
        // not break the next glide. Stop/replay/seek cannot continue backwards.
        if (!next) clear();
        if (!next || !isVisible || next.to <= next.from) return;
        try {
          const start = view.domAtPos(next.from, 1);
          const end = view.domAtPos(next.to, -1);
          const range = document.createRange();
          range.setStart(start.node, start.offset);
          range.setEnd(end.node, end.offset);
          const rects = Array.from(range.getClientRects()).filter(
            (r) => r.width && r.height,
          );
          if (!rects.length) {
            reset();
            return;
          }
          // A word may cross formatting marks or wrap. Merge only fragments
          // on the same line, never a bounding box across intervening text.
          const lineBox = (edge: DOMRect) => {
            const line = rects.filter(
              (r) => Math.abs(r.top - edge.top) < edge.height * 0.4,
            );
            const left = Math.min(...line.map((r) => r.left));
            const right = Math.max(...line.map((r) => r.right));
            const top = Math.min(...line.map((r) => r.top));
            const bottom = Math.max(...line.map((r) => r.bottom));
            return new DOMRect(left, top, right - left, bottom - top);
          };
          const first = lineBox(rects[0]),
            final = lineBox(rects[rects.length - 1]);
          if (viewport) {
            const bounds = viewport.getBoundingClientRect();
            if (
              first.top < bounds.top ||
              final.bottom > bounds.bottom ||
              first.left < bounds.left ||
              first.right > bounds.right
            ) {
              const element =
                start.node.nodeType === Node.TEXT_NODE
                  ? start.node.parentElement
                  : (start.node as HTMLElement);
              const word =
                element?.closest<HTMLElement>(".reading-word") ||
                element?.querySelector<HTMLElement>(".reading-word") ||
                element;
              word?.scrollIntoView({
                block: "nearest",
                inline: "nearest",
                behavior: "instant",
              });
              // Scrolling is immediate; do not sweep across the viewport jump.
              reset();
              return;
            }
          }
          if (motion.matches) {
            reset();
            return;
          }
          const origin = basis.getBoundingClientRect();
          if (!origin.width || !origin.height) {
            reset();
            return;
          }
          const sx = origin.width / 100,
            sy = origin.height / 100;
          const box = (r: DOMRect): WordBox => ({
            left: (r.left - origin.left) / sx,
            right: (r.right - origin.left) / sx,
            top: (r.top - origin.top) / sy,
            height: r.height / sy,
          });
          const target = box(first),
            time = performance.now(),
            old = previous;
          // Keep the native inline fragments for the uncommon wrapped word.
          // A single surface must never cover the unread space between lines.
          if (Math.abs(first.top - final.top) > first.height * 0.4) {
            reset();
            return;
          }
          const continuous =
            old &&
            time - old.time < 1600 &&
            next.start >= old.end &&
            next.start - old.end <= 8 &&
            !/\S/.test(projectText(next.doc).text.slice(old.end, next.start));
          const sameLine =
            continuous &&
            Math.abs(target.top - old.box.top) < target.height * 0.4;
          const forward =
            sameLine &&
            target.left >= old.box.right - 1 &&
            target.left - old.box.right < target.height * 1.5;
          const backward =
            sameLine &&
            target.right <= old.box.left + 1 &&
            old.box.left - target.right < target.height * 1.5;
          const hadInk = host.classList.contains("reading-ink-active");
          // One read at the boundary lets very fast speech release the actual
          // visible surface, even when its preceding handover is unfinished.
          const departing =
            hadInk && continuous ? box(ink.getBoundingClientRect()) : null;
          arrival?.cancel();
          departure?.cancel();
          arrival = departure = undefined;
          previous = { box: target, end: next.end, time, doc: next.doc };
          const place = (element: HTMLElement, bounds: WordBox) => {
            element.style.left = `${bounds.left}px`;
            element.style.top = `${bounds.top}px`;
            element.style.width = `${bounds.right - bounds.left}px`;
            element.style.height = `${bounds.height}px`;
          };
          place(ink, target);
          ink.style.opacity = "1";
          host.classList.add("reading-ink-active");
          // No tween ever delays the current word. The incoming ink starts
          // slightly outside its bounds and settles inward, covering it fully.
          const width = target.right - target.left;
          const duration = continuous
            ? Math.min(240, Math.max(95, (time - old.time) * 0.7))
            : 130;
          const timing = {
            duration,
            easing: "cubic-bezier(0.25, 0.72, 0.25, 1)",
          };
          if ((forward || backward) && width > 0) {
            const extension = Math.min(30, target.height * 1.3, width * 0.6);
            ink.style.transformOrigin = forward
              ? "right center"
              : "left center";
            arrival = ink.animate(
              [
                { transform: `scaleX(${1 + extension / width})` },
                { transform: "scaleX(1)" },
              ],
              timing,
            );
            if (departing) {
              // A feathered connection releases toward the new word. Its
              // opacity never competes with the fully filled current word.
              const edge = forward ? target.left : target.right;
              const released = {
                ...departing,
                left: forward ? departing.left : edge,
                right: forward ? edge : departing.right,
              };
              if (released.right > released.left) {
                place(release, released);
                release.style.transformOrigin = forward
                  ? "right center"
                  : "left center";
                release.style.backgroundColor = "transparent";
                release.style.backgroundImage = forward
                  ? "linear-gradient(to right, transparent, #e5c59a 72%)"
                  : "linear-gradient(to left, transparent, #e5c59a 72%)";
                departure = release.animate(
                  [
                    { transform: "scaleX(1)", opacity: 0.48 },
                    { transform: "scaleX(0.04)", opacity: 0 },
                  ],
                  timing,
                );
              }
            }
          } else if (
            continuous &&
            Math.abs(target.top - old.box.top) < target.height * 2.5
          ) {
            // At line breaks the ink reforms locally; no diagonal travel or
            // streak through the rest of the document.
            ink.style.transformOrigin = "center";
            arrival = ink.animate(
              [
                { transform: "scale(1.025, 1.12)" },
                { transform: "scale(1, 1)" },
              ],
              timing,
            );
            if (departing) {
              place(release, departing);
              release.style.backgroundImage = "none";
              release.style.backgroundColor = "#e5c59a";
              release.style.transformOrigin = "center";
              departure = release.animate(
                [
                  { transform: "scaleY(1)", opacity: 0.32 },
                  { transform: "scaleY(0.8)", opacity: 0 },
                ],
                { ...timing, duration: Math.min(140, duration) },
              );
            }
          }
          // Two bounded layers. All intermediate frames are transform/opacity
          // on the compositor: no JS loop, layout, or React/editor transaction.
        } catch {
          reset();
        }
      };
      last = null;
      update();
      return {
        update,
        destroy() {
          reset();
          resize.disconnect();
          viewport?.removeEventListener("scroll", reset);
          document.fonts.removeEventListener("loadingdone", reset);
          motion.removeEventListener("change", reset);
          ink.remove();
          release.remove();
          basis.remove();
          host.classList.remove("reading-highlight-host");
        },
      };
    },
  });
}
