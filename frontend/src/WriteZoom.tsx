import { useLayoutEffect, useRef } from "react";
import { useStoredPreference } from "./useStoredPreference";

export type WriteFit = "percentage" | "width" | "page";
export function fittedWriteZoom(
  mode: Exclude<WriteFit, "percentage">,
  viewport: { width: number; height: number },
  page: { width: number; height: number },
) {
  const width = Math.max(1, viewport.width - 48) / page.width;
  const height = Math.max(1, viewport.height - 48) / page.height;
  return Math.max(
    0.1,
    Math.min(3, mode === "page" ? Math.min(width, height) : width),
  );
}

/** Fit preferences do not change paper geometry. Observe the actual writing
 * viewport so opening a panel or a ruler recalculates the view automatically. */
export default function WriteZoom({
  zoom,
  onChange,
  page,
  identity,
  fitEnabled = true,
}: {
  zoom: number;
  onChange: (zoom: number) => void;
  page: { width: number; height: number };
  identity: string;
  fitEnabled?: boolean;
}) {
  const host = useRef<HTMLLabelElement>(null);
  const [saved, setSaved] = useStoredPreference("alder.writeFit", "percentage");
  const mode: WriteFit =
    fitEnabled && (saved === "width" || saved === "page")
      ? saved
      : "percentage";
  const latest = useRef({ zoom, onChange });
  latest.current = { zoom, onChange };
  const pending = useRef<{
    zoom: number;
    scroll: HTMLElement;
    range: Range | null;
    y?: number;
    top: number;
    left: number;
    ratio: number;
  } | null>(null);
  useLayoutEffect(() => {
    if (mode === "percentage") return;
    const scroll = host.current
      ?.closest(".book-main")
      ?.querySelector<HTMLElement>(".editor-scroll");
    if (!scroll) return;
    let update = 0;
    const measure = () => {
      const next = fittedWriteZoom(
        mode,
        { width: scroll.clientWidth, height: scroll.clientHeight },
        page,
      );
      if (
        !scroll.clientWidth ||
        !scroll.clientHeight ||
        Math.abs(next - latest.current.zoom) < 0.0001
      )
        return;
      const ratio = next / latest.current.zoom,
        top = scroll.scrollTop,
        left = scroll.scrollLeft;
      const selection = window.getSelection();
      const range =
        selection?.rangeCount && scroll.contains(selection.anchorNode)
          ? selection.getRangeAt(0).cloneRange()
          : null;
      const y = range?.getBoundingClientRect().top;
      pending.current = { zoom: next, scroll, range, y, top, left, ratio };
      latest.current.onChange(next);
    };
    const schedule = () => {
      cancelAnimationFrame(update);
      update = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(scroll);
    measure();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(update);
    };
  }, [mode, page.width, page.height, identity, zoom]);
  useLayoutEffect(() => {
    const held = pending.current;
    if (!held || held.zoom !== zoom) return;
    pending.current = null;
    const { scroll, range, y, top, left, ratio } = held;
    if (
      range?.startContainer.isConnected &&
      y != null &&
      scroll.contains(range.startContainer)
    )
      scroll.scrollTop += range.getBoundingClientRect().top - y;
    else
      scroll.scrollTop = Math.max(
        0,
        (top + scroll.clientHeight / 2) * ratio - scroll.clientHeight / 2,
      );
    scroll.scrollLeft = left * ratio;
  }, [zoom]);
  return (
    <label className="writing-zoom" ref={host}>
      Zoom{" "}
      <select
        aria-label="Page zoom"
        value={mode === "percentage" ? String(zoom) : mode}
        onChange={(event) => {
          const value = event.target.value;
          if (value === "width" || value === "page") setSaved(value);
          else {
            setSaved("percentage");
            onChange(Number(value));
          }
        }}
      >
        {fitEnabled && (
          <>
            <option value="width">
              Fit width{mode === "width" ? ` (${Math.round(zoom * 100)}%)` : ""}
            </option>
            <option value="page">
              Whole page{mode === "page" ? ` (${Math.round(zoom * 100)}%)` : ""}
            </option>
          </>
        )}
        {mode === "percentage" &&
          Math.abs(zoom * 20 - Math.round(zoom * 20)) > 0.0001 && (
            <option value={zoom}>{Math.round(zoom * 100)}%</option>
          )}
        {Array.from({ length: 51 }, (_, i) => (50 + i * 5) / 100).map(
          (value) => (
            <option key={value} value={value}>
              {Math.round(value * 100)}%
            </option>
          ),
        )}
      </select>
    </label>
  );
}
