import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { PageLayout } from "./pageFlow";

type Drag = {
  from: number;
  to: number;
  pointer: number;
  grabX: number;
  grabY: number;
  clientX: number;
  clientY: number;
  x: number;
  y: number;
  released?: boolean;
  slots: { x: number; y: number; width: number; height: number }[];
};

export default function PageArrangement({
  snapshots,
  layout,
  zoom,
  onZoom,
  onMove,
  areaRef,
}: {
  snapshots: string[];
  layout: PageLayout;
  zoom: number;
  onZoom: (update: (zoom: number) => number) => void;
  onMove: (from: number, to: number) => void;
  areaRef: RefObject<HTMLDivElement | null>;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const stop = () => {
    dragRef.current = null;
    setDrag(null);
  };
  const position = (current: Drag, clientX: number, clientY: number) => {
    const grid = gridRef.current!;
    const rect = grid.getBoundingClientRect();
    const scale = rect.width / grid.offsetWidth;
    const x = (clientX - rect.left) / scale - current.grabX;
    const y = (clientY - rect.top) / scale - current.grabY;
    const held = current.slots[current.from];
    let distance = Infinity,
      to = current.to;
    current.slots.forEach((slot, i) => {
      const next = Math.hypot(
        x + held.width / 2 - slot.x - slot.width / 2,
        y + held.height / 2 - slot.y - slot.height / 2,
      );
      if (next < distance) {
        distance = next;
        to = i;
      }
    });
    const next = { ...current, x, y, clientX, clientY, to };
    dragRef.current = next;
    setDrag(next);
  };
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    let accumulated = 0;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (dragRef.current || (event.target as Element).closest(".page-card"))
        return;
      accumulated +=
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? area.clientHeight
            : 1);
      const steps = Math.trunc(accumulated / 60);
      if (steps) {
        accumulated -= steps * 60;
        onZoom((value) =>
          Math.max(
            0.5,
            Math.min(3, Math.round((value - steps * 0.05) * 100) / 100),
          ),
        );
      }
    };
    area.addEventListener("wheel", wheel, { passive: false });
    return () => area.removeEventListener("wheel", wheel);
  }, [areaRef, onZoom]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") stop();
    };
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", stop);
    window.addEventListener("resize", stop);
    return () => {
      window.removeEventListener("keydown", escape);
      window.removeEventListener("blur", stop);
      window.removeEventListener("resize", stop);
    };
  }, []);
  useLayoutEffect(() => {
    stop();
  }, [snapshots, zoom]);
  useEffect(() => {
    if (!drag?.released) return;
    // A rejected/no-op editor move must not leave a lifted card behind.
    const timer = window.setTimeout(stop, 220);
    return () => window.clearTimeout(timer);
  }, [drag?.released]);
  useEffect(() => {
    if (!drag) return;
    let frame = 0;
    const scroll = () => {
      const current = dragRef.current,
        area = areaRef.current;
      if (!current || !area) return;
      const rect = area.getBoundingClientRect();
      const edge = 48;
      const velocity =
        current.clientY < rect.top + edge
          ? -Math.min(14, (rect.top + edge - current.clientY) / 4)
          : current.clientY > rect.bottom - edge
            ? Math.min(14, (current.clientY - rect.bottom + edge) / 4)
            : 0;
      if (
        velocity &&
        current.clientX >= rect.left &&
        current.clientX <= rect.right
      ) {
        const before = area.scrollTop;
        area.scrollTop += velocity;
        if (before !== area.scrollTop)
          position(current, current.clientX, current.clientY);
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [!!drag]);
  const order = snapshots.map((_, i) => i);
  if (drag) order.splice(drag.to, 0, order.splice(drag.from, 1)[0]);
  const width = layout.width * zoom * 0.35;
  const height = layout.height * zoom * 0.35;
  return (
    <div
      ref={areaRef}
      className={`page-arranger${drag ? " is-dragging" : ""}`}
      aria-label="Arrange pages"
      data-help="Drag a page to move it; release to confirm or press Escape to cancel. Scroll over the background to zoom. Use Go To Page or the scrollbar to navigate."
      onPointerMove={(event) => {
        if (dragRef.current?.pointer === event.pointerId)
          position(dragRef.current, event.clientX, event.clientY);
      }}
      onPointerUp={(event) => {
        const current = dragRef.current;
        if (!current || current.pointer !== event.pointerId) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom &&
          current.from !== current.to
        ) {
          dragRef.current = null;
          setDrag({
            ...current,
            x: current.slots[current.to].x,
            y: current.slots[current.to].y,
            released: true,
          });
          onMove(current.from, current.to);
        } else stop();
      }}
      onPointerCancel={stop}
      onLostPointerCapture={() => {
        if (dragRef.current) stop();
      }}
    >
      <div
        ref={gridRef}
        className="page-card-grid"
        style={{ gridTemplateColumns: `repeat(auto-fill, ${width}px)` }}
      >
        {drag && (
          <div
            className="page-drop-gap"
            aria-hidden="true"
            style={{
              left: drag.slots[drag.to].x,
              top: drag.slots[drag.to].y,
              width,
              height,
            }}
          />
        )}
        {snapshots.map((snapshot, i) => {
          const slot = drag?.slots[order.indexOf(i)],
            original = drag?.slots[i];
          const held = drag?.from === i;
          const transform =
            drag && slot && original
              ? `translate(${(held ? drag.x : slot.x) - original.x}px, ${(held ? drag.y : slot.y) - original.y}px)`
              : undefined;
          return (
            <article
              className={`page-card${held ? " is-held" : ""}`}
              key={i}
              aria-label={`Page ${i + 1}`}
              style={{ transform }}
              onDragStart={(event) => event.preventDefault()}
              onPointerDown={(event) => {
                if (event.button !== 0 || dragRef.current) return;
                event.preventDefault();
                const grid = gridRef.current!;
                const rect = event.currentTarget.getBoundingClientRect();
                const scale =
                  grid.getBoundingClientRect().width / grid.offsetWidth;
                const slots = Array.from(
                  grid.querySelectorAll<HTMLElement>(".page-card"),
                  (card) => ({
                    x: card.offsetLeft,
                    y: card.offsetTop,
                    width: card.offsetWidth,
                    height: card.offsetHeight,
                  }),
                );
                const next: Drag = {
                  from: i,
                  to: i,
                  pointer: event.pointerId,
                  grabX: (event.clientX - rect.left) / scale,
                  grabY: (event.clientY - rect.top) / scale,
                  clientX: event.clientX,
                  clientY: event.clientY,
                  x: slots[i].x,
                  y: slots[i].y,
                  slots,
                };
                dragRef.current = next;
                setDrag(next);
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
            >
              <div className="page-miniature" style={{ width, height }}>
                <div
                  inert
                  aria-hidden="true"
                  style={{
                    transform: `scale(${zoom * 0.35})`,
                    transformOrigin: "top left",
                  }}
                  dangerouslySetInnerHTML={{ __html: snapshot }}
                />
              </div>
              <span className="page-card-number">{i + 1}</span>
            </article>
          );
        })}
      </div>
    </div>
  );
}
