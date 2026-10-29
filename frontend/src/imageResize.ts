import { Plugin, NodeSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { closeHistory } from "prosemirror-history";

export function resizedImageWidth(
  start: number,
  delta: number,
  scale: number,
  maximum: number,
) {
  return (
    Math.round(Math.max(1, Math.min(maximum, start + delta / scale)) * 100) /
    100
  );
}

/** Resize paint lives outside the editable DOM. Pointer moves never serialize
 * the document or repaginate; releasing commits one authored width change. */
export function imageResize() {
  return new Plugin({
    view(view) {
      const overlay = document.createElement("div");
      overlay.className = "image-resize-overlay";
      overlay.hidden = true;
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "image-resize-handle";
      handle.setAttribute("aria-label", "Resize image");
      handle.title =
        "Drag to resize; arrow keys adjust width; Shift changes by 10 pixels";
      overlay.append(handle);
      document.body.append(overlay);
      let current = view,
        frame = 0,
        destroyed = false;
      let drag: {
        id: string;
        node: unknown;
        pointer: number;
        start: number;
        width: number;
        x: number;
        scale: number;
        maximum: number;
        ratio: number;
        left: number;
        top: number;
        align: string;
        ghost: HTMLImageElement;
      } | null = null;
      function selected(v: EditorView) {
        const selection = v.state.selection;
        if (
          !v.editable ||
          !(selection instanceof NodeSelection) ||
          !["image", "inline_image"].includes(selection.node.type.name)
        )
          return null;
        const figure = v.nodeDOM(selection.from) as HTMLElement | null;
        const image =
          figure instanceof HTMLImageElement
            ? figure
            : figure?.querySelector("img");
        return image?.offsetWidth
          ? {
              node: selection.node,
              position: selection.from,
              figure:
                (selection.node.isInline
                  ? image.closest("p,h1,h2,h3,h4,h5,h6")
                  : figure) || v.dom,
              align: selection.node.isInline
                ? "left"
                : selection.node.attrs.align,
              image,
            }
          : null;
      }
      function clipToViewport(rect: {
        left: number;
        top: number;
        right: number;
        bottom: number;
      }) {
        const viewport = current.dom
          .closest(".editor-scroll")
          ?.getBoundingClientRect();
        if (!viewport) return;
        const inset = (a: number) => `${Math.max(-10, a)}px`;
        overlay.style.clipPath = `inset(${inset(viewport.top - rect.top)} ${inset(rect.right - viewport.right)} ${inset(rect.bottom - viewport.bottom)} ${inset(viewport.left - rect.left)})`;
      }
      function paint() {
        frame = 0;
        if (destroyed || drag) return;
        const item = selected(current);
        overlay.hidden = !item;
        if (!item) return;
        const rect = item.image.getBoundingClientRect();
        handle.style.right = item.align === "right" ? "auto" : "";
        handle.style.left =
          item.align === "right" ? "calc(-5px * var(--ui-scale,1))" : "";
        overlay.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
        clipToViewport(rect);
      }
      function schedule() {
        if (!frame) frame = requestAnimationFrame(paint);
      }
      function commit(width: number, expected?: unknown) {
        const item = selected(current);
        if (
          !item ||
          (expected && item.node !== expected) ||
          width === Number(item.node.attrs.width)
        )
          return;
        current.dispatch(
          closeHistory(current.state.tr).setNodeMarkup(
            item.position,
            undefined,
            { ...item.node.attrs, width },
          ),
        );
        current.focus();
        schedule();
      }
      function finish(apply: boolean) {
        if (!drag) return;
        const held = drag;
        drag = null;
        held.ghost.remove();
        overlay.classList.remove("is-resizing");
        if (handle.hasPointerCapture(held.pointer))
          handle.releasePointerCapture(held.pointer);
        if (apply) commit(held.width, held.node);
        schedule();
      }
      handle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        const item = selected(current);
        if (!item) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = item.image.getBoundingClientRect(),
          scale = rect.width / item.image.offsetWidth;
        const ghost = item.image.cloneNode(true) as HTMLImageElement;
        ghost.removeAttribute("id");
        ghost.setAttribute("aria-hidden", "true");
        ghost.style.cssText =
          "display:block;width:100%;height:100%;max-width:none;max-height:none;pointer-events:none;opacity:.8";
        overlay.prepend(ghost);
        overlay.classList.add("is-resizing");
        drag = {
          id: item.node.attrs.blockId,
          node: item.node,
          pointer: event.pointerId,
          start: item.image.offsetWidth,
          width: item.image.offsetWidth,
          x: event.clientX,
          scale,
          maximum: Math.min(10000, item.figure.clientWidth),
          ratio: rect.height / rect.width,
          left: rect.left,
          top: rect.top,
          align: item.align,
          ghost,
        };
        handle.setPointerCapture(event.pointerId);
      });
      handle.addEventListener("pointermove", (event) => {
        if (!drag || event.pointerId !== drag.pointer) return;
        const factor =
          drag.align === "center" ? 2 : drag.align === "right" ? -1 : 1;
        drag.width = resizedImageWidth(
          drag.start,
          (event.clientX - drag.x) * factor,
          drag.scale,
          drag.maximum,
        );
        const width = drag.width * drag.scale,
          change = width - drag.start * drag.scale;
        overlay.style.width = `${width}px`;
        overlay.style.height = `${width * drag.ratio}px`;
        overlay.style.left = `${drag.left - (drag.align === "center" ? change / 2 : drag.align === "right" ? change : 0)}px`;
        const left = parseFloat(overlay.style.left);
        clipToViewport({
          left,
          top: drag.top,
          right: left + width,
          bottom: drag.top + width * drag.ratio,
        });
      });
      handle.addEventListener("pointerup", () => finish(true));
      handle.addEventListener("pointercancel", () => finish(false));
      handle.addEventListener("lostpointercapture", () => finish(false));
      handle.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
          current.focus();
          return;
        }
        if (
          !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
            event.key,
          )
        )
          return;
        const item = selected(current);
        if (!item) return;
        event.preventDefault();
        const delta =
          (["ArrowLeft", "ArrowDown"].includes(event.key) ? -1 : 1) *
          (event.shiftKey ? 10 : 1);
        commit(
          resizedImageWidth(
            item.image.offsetWidth,
            delta,
            1,
            Math.min(10000, item.figure.clientWidth),
          ),
        );
        handle.focus();
      });
      const escape = (event: KeyboardEvent) => {
        if (drag && event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      };
      const scroll = () => {
        if (drag) finish(false);
        schedule();
      };
      window.addEventListener("keydown", escape, true);
      window.addEventListener("scroll", scroll, true);
      window.addEventListener("resize", scroll);
      const observer = new ResizeObserver(schedule);
      observer.observe(view.dom);
      schedule();
      return {
        update(next, previous) {
          current = next;
          if (
            drag &&
            (next.state.doc !== previous.doc ||
              !next.state.selection.eq(previous.selection))
          )
            finish(false);
          schedule();
        },
        destroy() {
          destroyed = true;
          finish(false);
          cancelAnimationFrame(frame);
          observer.disconnect();
          window.removeEventListener("keydown", escape, true);
          window.removeEventListener("scroll", scroll, true);
          window.removeEventListener("resize", scroll);
          overlay.remove();
        },
      };
    },
  });
}
