import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EditorView } from "prosemirror-view";
import type { Command } from "prosemirror-state";
import {
  sizeTableColumns,
  tableContext,
  setTableProperties,
} from "./tableFormatting";
import { mirrorShiftToPosition } from "./mirroredMargins";
import { columnShiftToPosition } from "./columnLayout";
import { displayPoints, useLayoutUnit } from "./layoutUnits";
import { resizeTableBoundary, tableBoundaryPositions } from "./tableRuler";

type Frame = { left: number; top: number; right: number; bottom: number };
type Geometry = {
  left: number;
  widths: number[];
  align: string;
  available: number;
  rowBottom: number | null;
  rowHeight: number;
  identity: string;
};
export default function TableRulerControls({
  view,
  version,
  scale,
  clip,
  horizontalTop,
  vertical,
  pageTop,
  pageBottom,
  onCommand,
  onProperties,
}: {
  view: () => EditorView | null;
  version: unknown;
  scale: number;
  clip: Frame;
  horizontalTop?: number;
  vertical: boolean;
  pageTop: number;
  pageBottom: number;
  onCommand: (command: Command) => void;
  onProperties: () => void;
}) {
  const [unit] = useLayoutUnit(),
    [geometry, setGeometry] = useState<Geometry | null>(null);
  const [preview, setPreview] = useState<{
    widths: number[];
    height: number;
    coordinate: number;
    row: boolean;
  } | null>(null);
  const held = useRef<{
    index: number;
    start: number;
    geometry: Geometry;
    doc: unknown;
    from: number;
    to: number;
    value: NonNullable<typeof preview>;
  } | null>(null);
  const cancel = () => {
    held.current = null;
    setPreview(null);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && held.current) {
        e.preventDefault();
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
  useLayoutEffect(() => {
    const v = view(),
      context = v && tableContext(v.state);
    cancel();
    if (!v || !context) {
      setGeometry(null);
      return;
    }
    const wrapper = v.nodeDOM(context.tableStart - 1) as HTMLElement | null;
    const table = wrapper?.matches("table")
      ? (wrapper as HTMLTableElement)
      : wrapper?.querySelector("table");
    if (!table) {
      setGeometry(null);
      return;
    }
    const cols = Array.from(table.querySelectorAll(":scope > colgroup > col"));
    const widths = cols.map((c) => c.getBoundingClientRect().width / scale);
    if (widths.length !== context.map.width || widths.some((w) => w < 25)) {
      setGeometry(null);
      return;
    }
    // Column projections move a continuation independently from the source table.
    const shift =
      (mirrorShiftToPosition(v, context.tableStart, v.state.selection.from) +
        columnShiftToPosition(v, context.tableStart, v.state.selection.from)) *
      scale;
    const row = table.rows[context.top],
      rowRect = row?.getBoundingClientRect();
    const css = wrapper && getComputedStyle(wrapper);
    const available = wrapper
      ? wrapper.clientWidth -
        (parseFloat(css!.paddingLeft) || 0) -
        (parseFloat(css!.paddingRight) || 0)
      : widths.reduce((a, b) => a + b, 0);
    setGeometry({
      left: cols[0].getBoundingClientRect().left + shift,
      widths,
      align: context.table.attrs.align || "left",
      available,
      // Split/continued rows need a different height model: offer their numeric
      // minimum through Properties, never a misleading boundary in a page gap.
      rowBottom:
        rowRect &&
        context.bottom === context.top + 1 &&
        rowRect.top >= pageTop - 0.5 &&
        rowRect.bottom <= pageBottom + 0.5
          ? rowRect.bottom
          : null,
      rowHeight: (rowRect?.height || 0) / scale,
      identity: context.table.attrs.blockId,
    });
  }, [
    version,
    scale,
    clip.left,
    clip.top,
    clip.right,
    clip.bottom,
    pageTop,
    pageBottom,
    horizontalTop,
  ]);
  const g = geometry;
  if (!g) return null;
  const positions = tableBoundaryPositions(
    preview?.widths || g.widths,
    g.widths,
    g.align,
  );
  const commit = (value: NonNullable<typeof preview>) => {
    if (value.row)
      onCommand(
        setTableProperties(g.identity, {
          table: {},
          cells: {},
          rows: { minHeight: value.height * 0.75 },
        }),
      );
    else onCommand(sizeTableColumns(value.widths));
  };
  const handle = (index: number, row = false) => {
    const x = row ? clip.left : g.left + positions[index] * scale;
    const y = row
      ? preview?.row
        ? preview.coordinate
        : g.rowBottom!
      : horizontalTop!;
    return (
      <button
        key={row ? "row" : index}
        type="button"
        className={`table-ruler-handle ${row ? "table-ruler-row" : "table-ruler-column"}`}
        aria-label={
          row
            ? "Selected row minimum height"
            : `Table column boundary ${index + 1}`
        }
        title={
          row
            ? `Minimum row height: ${displayPoints((preview?.height ?? g.rowHeight) * 0.75, unit)} ${unit}. Double-click for properties.`
            : `Column ${Math.max(1, index)}: ${displayPoints((preview?.widths || g.widths)[Math.max(0, index - 1)] * 0.75, unit)} ${unit}. Double-click for properties.`
        }
        style={
          row ? { left: 0, top: y - clip.top } : { left: x - clip.left, top: 0 }
        }
        onDoubleClick={onProperties}
        onFocus={(event) => {
          const scroll = view()?.dom.closest<HTMLElement>(".editor-scroll");
          if (!scroll) return;
          const bounds = scroll.getBoundingClientRect(),
            rect = event.currentTarget.getBoundingClientRect();
          const ui = bounds.width / scroll.offsetWidth;
          const delta = row
            ? rect.top < bounds.top
              ? rect.top - bounds.top - 8
              : rect.bottom > bounds.bottom
                ? rect.bottom - bounds.bottom + 8
                : 0
            : rect.left < bounds.left
              ? rect.left - bounds.left - 8
              : rect.right > bounds.right
                ? rect.right - bounds.right + 8
                : 0;
          if (delta)
            scroll.scrollBy({
              [row ? "top" : "left"]: delta / ui,
              behavior: "instant",
            });
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          const v = view();
          if (!v) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          held.current = {
            index,
            start: row ? e.clientY : e.clientX,
            geometry: g,
            doc: v.state.doc,
            from: v.state.selection.from,
            to: v.state.selection.to,
            value: {
              widths: g.widths,
              height: g.rowHeight,
              coordinate: row ? g.rowBottom! : x,
              row,
            },
          };
        }}
        onPointerMove={(e) => {
          const h = held.current;
          if (!h) return;
          const step = e.altKey ? 0.01 : 96 / 25.4 / 2;
          const delta =
            Math.round(
              ((row ? e.clientY : e.clientX) - h.start) / scale / step,
            ) * step;
          if (row) {
            const height = Math.max(
              0,
              Math.min(1920, h.geometry.rowHeight + delta),
            );
            h.value = {
              ...h.value,
              height,
              coordinate:
                h.geometry.rowBottom! + (height - h.geometry.rowHeight) * scale,
            };
          } else {
            const widths = resizeTableBoundary(
              h.geometry.widths,
              index,
              delta,
              h.geometry.align,
              h.geometry.available,
            );
            if (!widths) return;
            h.value = {
              ...h.value,
              widths,
              coordinate:
                h.geometry.left +
                tableBoundaryPositions(
                  widths,
                  h.geometry.widths,
                  h.geometry.align,
                )[index] *
                  scale,
            };
          }
          setPreview(h.value);
        }}
        onPointerUp={(e) => {
          const h = held.current;
          if (!h) return;
          cancel();
          e.currentTarget.releasePointerCapture(e.pointerId);
          const v = view();
          if (
            !v ||
            v.state.doc !== h.doc ||
            v.state.selection.from !== h.from ||
            v.state.selection.to !== h.to
          )
            return;
          if (
            h.value.row
              ? h.value.height !== h.geometry.rowHeight
              : h.value.widths.some((w, i) => w !== h.geometry.widths[i])
          )
            commit(h.value);
        }}
        onLostPointerCapture={cancel}
        onPointerCancel={cancel}
        onKeyDown={(e) => {
          const keys = row
            ? ["ArrowUp", "ArrowDown"]
            : ["ArrowLeft", "ArrowRight"];
          if (!keys.includes(e.key)) return;
          e.preventDefault();
          const delta =
            ((e.key === keys[1] ? 1 : -1) * (e.shiftKey ? 10 : 1) * 4) / 3;
          if (row)
            commit({
              widths: g.widths,
              height: Math.max(0, Math.min(1920, g.rowHeight + delta)),
              coordinate: y,
              row,
            });
          else {
            const widths = resizeTableBoundary(
              g.widths,
              index,
              delta,
              g.align,
              g.available,
            );
            if (widths)
              commit({ widths, height: g.rowHeight, coordinate: x, row });
          }
          e.currentTarget.focus({ preventScroll: true });
        }}
      />
    );
  };
  return (
    <>
      {horizontalTop != null && (
        <div
          className="table-ruler-horizontal"
          style={{
            left: clip.left,
            top: horizontalTop,
            width: clip.right - clip.left,
          }}
        >
          {positions.map((_, index) =>
            (index === 0 && g.align === "left") ||
            (index === g.widths.length && g.align === "right")
              ? null
              : handle(index),
          )}
        </div>
      )}
      {vertical && g.rowBottom != null && (
        <div
          className="table-ruler-vertical"
          style={{
            left: clip.left,
            top: clip.top,
            height: clip.bottom - clip.top,
          }}
        >
          {handle(0, true)}
        </div>
      )}
      {preview &&
        createPortal(
          <div
            className={`ruler-drag-guide${preview.row ? " table-ruler-row-guide" : ""}`}
            style={
              preview.row
                ? {
                    left: clip.left,
                    top: preview.coordinate,
                    width: clip.right - clip.left,
                  }
                : {
                    left: preview.coordinate,
                    top: clip.top,
                    height: clip.bottom - clip.top,
                  }
            }
          >
            <output>
              {preview.row ? "Minimum row height" : "Column width"}:{" "}
              {displayPoints(
                (preview.row
                  ? preview.height
                  : preview.widths[
                      Math.max(0, (held.current?.index || 0) - 1)
                    ]) * 0.75,
                unit,
              )}{" "}
              {unit}
            </output>
          </div>,
          document.body,
        )}
    </>
  );
}
