import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { columnGapAt, columnRulerEdges } from "./columnRuler";
import { displayPoints, useLayoutUnit } from "./layoutUnits";
import type { Columns } from "./columns";

export default function ColumnRulerControls({
  columns,
  body,
  left,
  origin,
  scale,
  top,
  bottom,
  version,
  onChange,
  onProperties,
}: {
  columns: Columns;
  body: number;
  left: number;
  origin: number;
  scale: number;
  top: number;
  bottom: number;
  version: unknown;
  onChange: (columns: Columns) => void;
  onProperties: () => void;
}) {
  const [unit] = useLayoutUnit();
  const [preview, setPreview] = useState<{ gap: number; x: number } | null>(
    null,
  );
  const held = useRef<{
    gap: number;
    x: number;
    edge: ReturnType<typeof columnRulerEdges>[number];
  } | null>(null);
  const cancel = () => {
    held.current = null;
    setPreview(null);
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && held.current) {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", cancel);
    };
  }, []);
  useEffect(cancel, [version, left, scale, body, columns]);
  const original = (columns.gapMm * 96) / 25.4;
  const gap = preview?.gap ?? original;
  return (
    <>
      {columnRulerEdges(body, columns.count, gap).map((edge) => (
        <button
          key={`${edge.index}-${edge.side}`}
          type="button"
          className="column-ruler-edge"
          aria-label={`Column gap ${edge.index + 1} ${edge.side} edge`}
          title={`Gap: ${displayPoints(gap * 0.75, unit)} ${unit}. Drag to adjust equal columns; double-click for settings.`}
          style={{ left: left - origin + edge.position * scale }}
          onDoubleClick={onProperties}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            held.current = { gap: original, x: event.clientX, edge };
          }}
          onPointerMove={(event) => {
            if (!held.current) return;
            const step = event.altKey ? 0.01 : 96 / 25.4 / 2;
            const next = columnGapAt(
              (event.clientX - left) / scale,
              held.current.edge,
              body,
              columns.count,
            );
            const bounded = columnGapAt(
              held.current.edge.base +
                held.current.edge.factor * Math.round(next / step) * step,
              held.current.edge,
              body,
              columns.count,
            );
            held.current = {
              ...held.current,
              gap: bounded,
              x:
                left +
                (held.current.edge.base + held.current.edge.factor * bounded) *
                  scale,
            };
            setPreview(held.current);
          }}
          onPointerUp={(event) => {
            const current = held.current;
            if (!current) return;
            cancel();
            event.currentTarget.releasePointerCapture(event.pointerId);
            if (current.gap !== original)
              onChange({ ...columns, gapMm: (current.gap * 25.4) / 96 });
          }}
          onPointerCancel={cancel}
          onLostPointerCapture={cancel}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
            event.preventDefault();
            const next = columnGapAt(
              edge.position +
                ((event.key === "ArrowRight" ? 1 : -1) *
                  (event.shiftKey ? 10 : 1) *
                  4) /
                  3,
              edge,
              body,
              columns.count,
            );
            if (next !== original)
              onChange({ ...columns, gapMm: (next * 25.4) / 96 });
          }}
        />
      ))}
      {preview &&
        createPortal(
          <div
            className="ruler-drag-guide"
            style={{ left: preview.x, top, height: Math.max(0, bottom - top) }}
          >
            <output>
              Column gap: {displayPoints(preview.gap * 0.75, unit)} {unit}
            </output>
          </div>,
          document.body,
        )}
    </>
  );
}
