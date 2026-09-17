import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import type { ArrangementUnit } from "./arrangementUnits";
import { unitDragFeedback } from "./arrangementPreview";

type Held = {
  unit: ArrangementUnit;
  pointer: number;
  x: number;
  y: number;
  grabX: number;
  grabY: number;
  width: number;
  height: number;
  html: string;
  scale: number;
  cropX: number;
  cropY: number;
  destination: number | null;
  owner: HTMLElement;
  mask: string;
  feedback: ReturnType<typeof unitDragFeedback>;
};

export function useUnitDragging(
  move: (unit: ArrangementUnit, at: number) => void,
  snapshots: string[],
) {
  const current = useRef<Held | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const [held, setHeld] = useState<Held | null>(null);
  const cancel = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    current.current?.feedback.destroy();
    current.current = null;
    suppressClick.current = false;
    setHeld(null);
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    return () => {
      window.removeEventListener("keydown", escape);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
      cancel();
    };
  }, []);
  useEffect(() => {
    cancel();
  }, [snapshots]);

  const start = (event: ReactPointerEvent, layer: HTMLElement) => {
    cancel();
    const unit = JSON.parse(layer.dataset.unit!) as ArrangementUnit;
    const sheet = layer.closest<HTMLElement>(".page-miniature")!;
    const snapshot = layer.closest<HTMLElement>(".page-snapshot")!;
    const rects = Array.from(layer.children, (child) =>
      child.getBoundingClientRect(),
    );
    const left = Math.min(...rects.map((rect) => rect.left)),
      top = Math.min(...rects.map((rect) => rect.top));
    const right = Math.max(...rects.map((rect) => rect.right)),
      bottom = Math.max(...rects.map((rect) => rect.bottom));
    const pageRect = sheet.getBoundingClientRect();
    const scale = pageRect.width / parseFloat(snapshot.style.width);
    const owner =
      sheet.closest<HTMLElement>(".arrangement-page-focus") ||
      sheet.closest<HTMLElement>(".page-arranger")!;
    // Clone the displayed page once. Never regenerate its HTML on pointermove.
    const copy = snapshot.cloneNode(true) as HTMLElement;
    copy.querySelectorAll(".arrangement-unit").forEach((el) => el.remove());
    const next: Held = {
      unit,
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      grabX: event.clientX - left,
      grabY: event.clientY - top,
      width: right - left,
      height: bottom - top,
      html: copy.outerHTML,
      scale,
      cropX: pageRect.left - left,
      cropY: pageRect.top - top,
      destination: null,
      owner,
      feedback: unitDragFeedback(owner, unit),
      mask: `path("${rects.map((rect) => `M${rect.left - left} ${rect.top - top}h${rect.width}v${rect.height}h${-rect.width}Z`).join(" ")}")`,
    };
    current.current = next;
    setHeld(next);
    event.preventDefault();
    event.stopPropagation();
    owner.setPointerCapture(event.pointerId);
  };
  const locate = (drag: Held) => {
    const hit = document
      .elementFromPoint(drag.x, drag.y)
      ?.closest<HTMLElement>("[data-page]");
    const sheet =
      hit && drag.owner.contains(hit)
        ? hit.matches(".page-miniature")
          ? hit
          : hit.querySelector<HTMLElement>(".page-miniature")
        : null;
    const target = sheet ? drag.feedback.target(sheet, drag.x, drag.y) : null;
    drag.destination = target?.pos ?? null;
    return { sheet, target };
  };
  const paint = () => {
    frame.current = null;
    const drag = current.current;
    if (!drag) return;
    // Only compositor transforms move the held unit. React and the editor stay idle.
    if (ghostRef.current)
      ghostRef.current.style.transform = `translate3d(${drag.x - drag.grabX}px,${drag.y - drag.grabY}px,0)`;
    const { sheet, target } = locate(drag);
    drag.feedback.show(sheet, target, drag.height / drag.scale);
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    const drag = current.current;
    if (!drag || event.pointerId !== drag.pointer) return;
    event.stopPropagation();
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (frame.current === null) frame.current = requestAnimationFrame(paint);
  };
  const onPointerUp = (event: ReactPointerEvent) => {
    const drag = current.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    event.stopPropagation();
    const pending =
      frame.current !== null ||
      drag.x !== event.clientX ||
      drag.y !== event.clientY;
    drag.x = event.clientX;
    drag.y = event.clientY;
    // Pointerup may arrive before the queued frame. Use its actual drop position.
    if (pending) locate(drag);
    const destination = drag.destination;
    cancel();
    if (destination !== null) move(drag.unit, destination);
    suppressClick.current = true;
  };
  const ghost = held
    ? createPortal(
        <div
          ref={ghostRef}
          className={`unit-held unit-${held.unit.kind}`}
          aria-hidden="true"
          style={{
            position: "fixed",
            left: 0,
            top: 0,
            transform: `translate3d(${held.x - held.grabX}px,${held.y - held.grabY}px,0)`,
            width: held.width,
            height: held.height,
          }}
        >
          <div style={{ position: "absolute", inset: 0, clipPath: held.mask }}>
            <div
              style={{
                position: "absolute",
                left: held.cropX,
                top: held.cropY,
                transform: `scale(${held.scale})`,
                transformOrigin: "top left",
              }}
              dangerouslySetInnerHTML={{ __html: held.html }}
            />
          </div>
        </div>,
        document.body,
      )
    : null;
  return {
    start,
    cancel,
    active: !!held,
    ghost,
    onPointerMove,
    onPointerUp,
    onPointerCancel: cancel,
    consumeClick: () => {
      const consumed = suppressClick.current;
      suppressClick.current = false;
      return consumed;
    },
  };
}
