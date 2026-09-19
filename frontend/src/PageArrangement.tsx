import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { openContextMenu } from "./ContextMenu";
import type { PageLayout } from "./pageFlow";
import type { ArrangementUnit } from "./arrangementUnits";
import { useUnitDragging } from "./useUnitDragging";

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
  onMoveUnit,
}: {
  snapshots: string[];
  layout: PageLayout;
  zoom: number;
  onZoom: (update: (zoom: number) => number) => void;
  onMove: (from: number, to: number) => void;
  areaRef: RefObject<HTMLDivElement | null>;
  onMoveUnit: (unit: ArrangementUnit, destination: number) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const units = useUnitDragging(onMoveUnit, snapshots);
  const rendered = snapshots;
  const [selection, setSelection] = useState<{
    pages: number[];
    anchor: number;
  } | null>(null);
  const [group, setGroup] = useState<{
    pages: number[];
    zoom: number;
    top: number;
    left: number;
    scale: number;
  } | null>(null);
  const restore = useRef<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    setSelection((old) =>
      old
        ? { ...old, pages: old.pages.filter((i) => i < snapshots.length) }
        : old,
    );
    setGroup((old) =>
      old && snapshots.length
        ? {
            ...old,
            pages: Array.from(
              new Set(old.pages.map((i) => Math.min(i, snapshots.length - 1))),
            ),
          }
        : null,
    );
  }, [snapshots.length]);
  const selectPage = (page: number, shift: boolean, additive: boolean) => {
    setSelection((old) => {
      if (!old) return { pages: [page], anchor: page };
      if (shift) {
        const range = Array.from(
          { length: Math.abs(page - old.anchor) + 1 },
          (_, i) => Math.min(page, old.anchor) + i,
        );
        return {
          pages: Array.from(
            new Set([
              ...(additive ? old.pages : old.pages.slice(0, 1)),
              ...range,
            ]),
          ),
          anchor: old.anchor,
        };
      }
      return {
        pages: old.pages.includes(page)
          ? old.pages.filter((i) => i !== page)
          : [...old.pages, page],
        anchor: page,
      };
    });
  };
  const closeGroup = () => {
    if (!group) return;
    restore.current = { top: group.top, left: group.left };
    onZoom(() => group.zoom);
    setGroup(null);
    units.cancel();
  };
  useLayoutEffect(() => {
    if (restore.current && !group && areaRef.current) {
      areaRef.current.scrollTop = restore.current.top;
      areaRef.current.scrollLeft = restore.current.left;
      restore.current = null;
    }
  }, [group, zoom]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (units.active) return;
      if (selection) setSelection(null);
      else if (group && !focusedPage) closeGroup();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  });
  const [focusedPage, setFocusedPage] = useState<{
    index: number;
    html: string;
    scrollTop: number;
    scrollLeft: number;
  } | null>(null);
  const focusRef = useRef<HTMLDivElement>(null);
  const [focusScale, setFocusScale] = useState(1);
  const closeFocus = () => {
    if (focusedPage && areaRef.current) {
      areaRef.current.scrollTop = focusedPage.scrollTop;
      areaRef.current.scrollLeft = focusedPage.scrollLeft;
    }
    setFocusedPage(null);
  };
  useLayoutEffect(() => {
    const overlay = focusRef.current;
    if (!overlay) return;
    const fit = () =>
      setFocusScale(
        Math.max(
          0.05,
          Math.min(
            (overlay.clientWidth - 64) / layout.width,
            (overlay.clientHeight - 64) / layout.height,
          ),
        ),
      );
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(overlay);
    const preventWheel = (event: WheelEvent) => event.preventDefault();
    overlay.addEventListener("wheel", preventWheel, { passive: false });
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !units.active) closeFocus();
    };
    document.addEventListener("keydown", escape);
    overlay.focus({ preventScroll: true });
    return () => {
      observer.disconnect();
      overlay.removeEventListener("wheel", preventWheel);
      document.removeEventListener("keydown", escape);
    };
  }, [focusedPage, layout.width, layout.height, units.active]);
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
      if (
        dragRef.current ||
        units.active ||
        (event.target as Element).closest(".page-card")
      )
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
  }, [areaRef, onZoom, units.active]);
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
  const displayScale = group ? (group.scale * zoom) / group.zoom : zoom * 0.35;
  const width = layout.width * displayScale;
  const height = layout.height * displayScale;
  const visiblePages = group ? group.pages : rendered.map((_, i) => i);
  return (
    <>
      <div
        ref={areaRef}
        inert={focusedPage !== null}
        className={`page-arranger${drag ? " is-dragging" : ""}${selection ? " is-selecting-pages" : ""}${units.active ? " is-moving-unit" : ""}`}
        aria-label="Arrange pages"
        onClickCapture={(event) => {
          if (units.consumeClick()) event.stopPropagation();
        }}
        data-help="Double-click a page to view it in full; click outside it to return. Drag to move a page. Scroll over the background to zoom."
        onPointerMove={(event) => {
          units.onPointerMove(event);
          if (units.active) return;
          if (dragRef.current?.pointer === event.pointerId)
            position(dragRef.current, event.clientX, event.clientY);
        }}
        onPointerUp={(event) => {
          units.onPointerUp(event);
          if (units.active) return;
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
        onPointerCancel={() => {
          stop();
          units.cancel();
        }}
        onLostPointerCapture={() => {
          if (dragRef.current) stop();
        }}
      >
        <div
          ref={gridRef}
          className="page-card-grid"
          style={{
            gridTemplateColumns: group
              ? `repeat(${visiblePages.length}, ${width}px)`
              : `repeat(auto-fill, ${width}px)`,
          }}
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
          {visiblePages.map((i) => {
            const snapshot = rendered[Math.min(i, rendered.length - 1)];
            const slot = drag?.slots[order.indexOf(i)],
              original = drag?.slots[i];
            const held = drag?.from === i;
            const transform =
              drag && slot && original
                ? `translate(${(held ? drag.x : slot.x) - original.x}px, ${(held ? drag.y : slot.y) - original.y}px)`
                : undefined;
            return (
              <article
                className={`page-card${held ? " is-held" : ""}${selection?.pages.includes(i) ? " is-selected" : ""}`}
                key={i}
                data-page={i}
                aria-label={`Page ${i + 1}`}
                style={{ transform }}
                onDoubleClick={() => {
                  if (selection) return;
                  stop();
                  const area = areaRef.current!;
                  setFocusedPage({
                    index: i,
                    html: snapshot,
                    scrollTop: area.scrollTop,
                    scrollLeft: area.scrollLeft,
                  });
                }}
                onDragStart={(event) => event.preventDefault()}
                onContextMenu={(event) => {
                  event.preventDefault();
                  stop();
                  units.cancel();
                  openContextMenu(
                    event,
                    [
                      {
                        label: "Arrange with...",
                        run: () => {
                          if (group) closeGroup();
                          setSelection({ pages: [i], anchor: i });
                        },
                      },
                      {
                        label: "Focus page",
                        run: () => {
                          const area = areaRef.current!;
                          setFocusedPage({
                            index: i,
                            html: snapshot,
                            scrollTop: area.scrollTop,
                            scrollLeft: area.scrollLeft,
                          });
                        },
                      },
                      ...(group
                        ? [{ label: "Back to Arrangement", run: closeGroup }]
                        : []),
                    ],
                    {
                      label: `Page ${i + 1} actions`,
                      className: "arrangement-context-menu",
                    },
                  );
                }}
                onClick={(event) => {
                  if (
                    selection ||
                    event.ctrlKey ||
                    event.metaKey ||
                    event.shiftKey
                  )
                    selectPage(
                      i,
                      event.shiftKey,
                      event.ctrlKey || event.metaKey,
                    );
                }}
                onPointerDown={(event) => {
                  if (
                    selection ||
                    event.ctrlKey ||
                    event.metaKey ||
                    event.shiftKey
                  )
                    return;
                  const unit = (event.target as Element).closest<HTMLElement>(
                    ".arrangement-unit",
                  );
                  if (unit && event.button === 0) {
                    units.start(event, unit);
                    return;
                  }
                  if (group || units.active) return;
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
                    aria-hidden="true"
                    style={{
                      transform: `scale(${displayScale})`,
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
      {selection && (
        <div className="arrange-selection-actions">
          <span>{selection.pages.length} selected</span>
          <button
            disabled={selection.pages.length < 2}
            onClick={() => {
              const area = areaRef.current!;
              setGroup({
                pages: selection.pages,
                zoom,
                top: area.scrollTop,
                left: area.scrollLeft,
                scale: Math.max(
                  0.15,
                  Math.min(
                    (area.clientWidth - 72) /
                      (layout.width * Math.min(2, selection.pages.length)),
                    (area.clientHeight - 72) / layout.height,
                  ),
                ),
              });
              setSelection(null);
              area.scrollTop = 0;
              area.scrollLeft = 0;
            }}
          >
            Arrange
          </button>
          <button onClick={() => setSelection(null)}>Cancel</button>
        </div>
      )}
      {group && !selection && (
        <button className="arrange-back" onClick={closeGroup}>
          Back to Arrangement
        </button>
      )}
      {focusedPage && (
        <div
          ref={focusRef}
          className="arrangement-page-focus"
          role="dialog"
          aria-label={`Page ${focusedPage.index + 1} full view`}
          tabIndex={-1}
          onPointerDown={(event) => {
            const unit = (event.target as Element).closest<HTMLElement>(
              ".arrangement-unit",
            );
            if (unit && event.button === 0) units.start(event, unit);
          }}
          onPointerMove={units.onPointerMove}
          onPointerUp={units.onPointerUp}
          onPointerCancel={units.cancel}
          onClick={(event) => {
            if (units.consumeClick()) return;
            if (units.active) return;
            if (!(event.target as Element).closest(".focused-page-sheet"))
              closeFocus();
          }}
        >
          <div>
            <div
              className="focused-page-sheet page-miniature"
              data-page={focusedPage.index}
              style={{
                width: layout.width * focusScale,
                height: layout.height * focusScale,
              }}
            >
              <div
                aria-hidden="true"
                style={{
                  transform: `scale(${focusScale})`,
                  transformOrigin: "top left",
                }}
                dangerouslySetInnerHTML={{
                  __html: rendered[focusedPage.index] || focusedPage.html,
                }}
              />
            </div>
            <span className="page-card-number">{focusedPage.index + 1}</span>
          </div>
        </div>
      )}
      {units.ghost}
    </>
  );
}
