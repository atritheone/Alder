import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EditorView } from "prosemirror-view";
import type { TabStop } from "./tabStops";

const preference = "alder.ruler";
export function useRuler() {
  const [visible, setVisible] = useState(
    () => localStorage.getItem(preference) === "true",
  );
  useEffect(() => {
    const update = () =>
      setVisible(localStorage.getItem(preference) === "true");
    window.addEventListener("alder-ruler", update);
    return () => window.removeEventListener("alder-ruler", update);
  }, []);
  return [
    visible,
    () => {
      localStorage.setItem(preference, String(!visible));
      window.dispatchEvent(new Event("alder-ruler"));
    },
  ] as const;
}

export default function ParagraphRuler({
  view,
  stops,
  onChange,
  paragraph,
  onFormat,
  version,
}: {
  view: () => EditorView | null;
  stops: TabStop[];
  onChange: (stops: TabStop[]) => void;
  paragraph: Record<string, unknown>;
  onFormat: (attributes: Record<string, unknown>) => void;
  version: unknown;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState({ left: 0, width: 0, unit: 4 / 3 });
  const [drag, setDrag] = useState<{ index: number; position: number } | null>(
    null,
  );
  const dragRef = useRef<typeof drag>(null);
  const indentDrag = useRef<{ key: string; value: number } | null>(null);
  const [indentPreview, setIndentPreview] = useState<Record<string, number>>(
    {},
  );
  useLayoutEffect(() => {
    const editor = view();
    if (!editor || !host.current) return;
    const measure = () => {
      const current = editor.state.selection.$from;
      if (!current.parent.isTextblock || !current.depth || !host.current)
        return;
      const block = editor.nodeDOM(current.before()) as HTMLElement | null;
      if (!block?.offsetWidth) return;
      const rect = block.getBoundingClientRect(),
        origin = host.current.getBoundingClientRect();
      const hostScale = origin.width / host.current.offsetWidth;
      const indent =
        ((parseFloat(getComputedStyle(block).marginLeft) || 0) * rect.width) /
        block.offsetWidth;
      const right =
        ((parseFloat(getComputedStyle(block).marginRight) || 0) * rect.width) /
        block.offsetWidth;
      const next = {
        left: (rect.left - indent - origin.left) / hostScale,
        width: (rect.width + indent + right) / hostScale,
        unit: ((rect.width / block.offsetWidth / hostScale) * 4) / 3,
      };
      setGeometry((old) =>
        JSON.stringify(old) === JSON.stringify(next) ? old : next,
      );
    };
    measure();
    const scroll = editor.dom.closest(".editor-scroll");
    scroll?.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      scroll?.removeEventListener("scroll", measure);
    };
  }, [version, stops]);
  const at = (event: React.PointerEvent) => {
    const rect = host.current!.getBoundingClientRect();
    const scale = rect.width / host.current!.offsetWidth;
    return Math.max(
      0.5,
      Math.min(
        1440,
        Math.round(
          (((event.clientX - rect.left) / scale - geometry.left) /
            geometry.unit) *
            2,
        ) / 2,
      ),
    );
  };
  const change = (index: number, position?: number) => {
    const next = stops.filter((_, i) => i !== index);
    if (position != null && next.some((s) => s.position === position)) return;
    if (position != null && !next.some((s) => s.position === position))
      next.push({ ...stops[index], position });
    onChange(next.sort((a, b) => a.position - b.position));
  };
  const value = (key: string) =>
    indentPreview[key] ?? Number(paragraph[key] || 0);
  const bodyWidth = geometry.width / geometry.unit;
  const indentPosition = (key: string, v: number) =>
    key === "rightIndent"
      ? bodyWidth - v
      : key === "firstLineIndent"
        ? value("leftIndent") + v
        : v;
  const indentValue = (key: string, event: React.PointerEvent) => {
    const rect = host.current!.getBoundingClientRect();
    const x =
      ((event.clientX - rect.left) / (rect.width / host.current!.offsetWidth) -
        geometry.left) /
      geometry.unit;
    return Math.max(
      -144,
      Math.min(
        144,
        Math.round(
          (key === "rightIndent"
            ? bodyWidth - x
            : key === "firstLineIndent"
              ? x - value("leftIndent")
              : x) * 2,
        ) / 2,
      ),
    );
  };
  return (
    <div
      className="paragraph-ruler"
      ref={host}
      aria-label="Paragraph ruler in points"
    >
      <div
        className="ruler-track"
        style={{ left: geometry.left, width: geometry.width }}
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget || event.button !== 0)
            return;
          event.preventDefault();
          const position = at(event);
          if (stops.length < 64 && !stops.some((s) => s.position === position))
            onChange(
              [
                ...stops,
                { position, align: "left" as const, leader: "none" as const },
              ].sort((a, b) => a.position - b.position),
            );
        }}
      >
        {(
          [
            ["leftIndent", "Left indent"],
            ["firstLineIndent", "First line indent"],
            ["rightIndent", "Right indent"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`ruler-indent ruler-indent-${key}`}
            aria-label={`${label}: ${value(key)} points`}
            title={`${label}: ${value(key)} pt`}
            style={{ left: indentPosition(key, value(key)) * geometry.unit }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              indentDrag.current = { key, value: value(key) };
            }}
            onPointerMove={(e) => {
              if (!indentDrag.current) return;
              const next = indentValue(key, e);
              indentDrag.current = { key, value: next };
              setIndentPreview({ [key]: next });
            }}
            onPointerUp={(e) => {
              if (!indentDrag.current) return;
              e.currentTarget.releasePointerCapture(e.pointerId);
              onFormat({ [key]: indentDrag.current.value });
              indentDrag.current = null;
              setIndentPreview({});
            }}
            onPointerCancel={() => {
              indentDrag.current = null;
              setIndentPreview({});
            }}
            onKeyDown={(e) => {
              if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
              e.preventDefault();
              const next =
                value(key) +
                (e.key === "ArrowRight" ? 1 : -1) *
                  (key === "rightIndent" ? -1 : 1) *
                  (e.shiftKey ? 10 : 1);
              onFormat({ [key]: Math.max(-144, Math.min(144, next)) });
            }}
          />
        ))}
        {Array.from(
          { length: Math.floor(geometry.width / geometry.unit / 36) + 1 },
          (_, i) => (
            <span
              className="ruler-tick"
              key={i}
              style={{ left: i * 36 * geometry.unit }}
              aria-hidden="true"
            >
              {i * 36}
            </span>
          ),
        )}
        {stops.map((stop, i) => (
          <button
            key={i}
            type="button"
            className={`ruler-tab ruler-tab-${stop.align}`}
            aria-label={`${stop.align} tab at ${stop.position} points`}
            title={`${stop.position} pt · ${stop.align} tab. Drag to move; Delete to remove.`}
            style={{
              left:
                (drag?.index === i ? drag.position : stop.position) *
                geometry.unit,
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              dragRef.current = { index: i, position: stop.position };
              setDrag(dragRef.current);
            }}
            onPointerMove={(event) => {
              if (!dragRef.current) return;
              dragRef.current = { index: i, position: at(event) };
              setDrag(dragRef.current);
            }}
            onPointerUp={(event) => {
              if (!dragRef.current) return;
              event.currentTarget.releasePointerCapture(event.pointerId);
              change(i, dragRef.current.position);
              dragRef.current = null;
              setDrag(null);
            }}
            onPointerCancel={() => {
              dragRef.current = null;
              setDrag(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Delete" || event.key === "Backspace") {
                event.preventDefault();
                change(i);
              } else if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
                event.preventDefault();
                change(
                  i,
                  Math.max(
                    0.5,
                    Math.min(
                      1440,
                      stop.position +
                        (event.key === "ArrowRight" ? 1 : -1) *
                          (event.shiftKey ? 10 : 1),
                    ),
                  ),
                );
              }
            }}
          >
            <span aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}
