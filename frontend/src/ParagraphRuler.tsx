import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { displayPoints, layoutUnits, rulerTickStep, useLayoutUnit } from "./layoutUnits";
import type { EditorView } from "prosemirror-view";
import type { TabStop } from "./tabStops";
import { mirrorShiftToPosition } from "./mirroredMargins";
import { columnShiftToPosition } from "./columnLayout";
import { createPortal } from "react-dom";
import { maximumParagraphIndent, rulerIndentChange, type RulerIndent } from "./rulerIndents";

export function useRuler(defaultVisible = true, scope: "write" | "sandbox" = "write") {
  const preference = scope === "write" ? "alder.ruler" : "alder.ruler.sandbox";
  const read = () => {
    const saved = localStorage.getItem(preference);
    return saved == null ? defaultVisible : saved === "true";
  };
  const [visible, setVisible] = useState(read);
  useEffect(() => {
    const update = () => setVisible(read());
    update();
    window.addEventListener("alder-ruler", update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener("alder-ruler", update);
      window.removeEventListener("storage", update);
    };
  }, [preference, defaultVisible]);
  return [visible, () => {
    localStorage.setItem(preference, String(!visible));
    window.dispatchEvent(new Event("alder-ruler"));
  }] as const;
}

export default function ParagraphRuler({
  view,
  stops,
  onChange,
  paragraph,
  onFormat,
  onHanging,
  onProperties,
  defaultInterval = 36,
  version,
  mixed = false,
}: {
  view: () => EditorView | null;
  stops: TabStop[];
  onChange: (stops: TabStop[]) => void;
  paragraph: Record<string, unknown>;
  onFormat: (attributes: Record<string, unknown>) => void;
  onHanging: (value: number, rtl: boolean) => void;
  onProperties: () => void;
  defaultInterval?: number;
  version: unknown;
  mixed?: boolean;
}) {
  const [unit] = useLayoutUnit();
  const [tabAlign, setTabAlign] = useState<TabStop["align"] | "firstLineIndent" | "hangingIndent">("left");
  const host = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState({
    left: 0,
    width: 0,
    unit: 4 / 3,
    rtl: false,
  });
  const [drag, setDrag] = useState<{ index: number; position: number; outside?: boolean } | null>(
    null,
  );
  const dragRef = useRef<typeof drag>(null);
  const source = useRef<{doc:EditorView["state"]["doc"];from:number;to:number}|null>(null);
  const captureSource = () => { const state=view()?.state;source.current=state?{doc:state.doc,from:state.selection.from,to:state.selection.to}:null; };
  const indentDrag = useRef<{ key: RulerIndent; value: number } | null>(null);
  const [indentPreview, setIndentPreview] = useState<Record<string, number>>(
    {},
  );
  const cancel = () => { source.current=null;dragRef.current = null; indentDrag.current = null; setDrag(null); setIndentPreview({}); };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && (dragRef.current || indentDrag.current)) {
        event.preventDefault(); cancel();
      }
    };
    window.addEventListener("keydown", escape, true);
    window.addEventListener("blur", cancel);
    return () => { window.removeEventListener("keydown", escape, true); window.removeEventListener("blur", cancel); };
  }, []);
  useLayoutEffect(() => {
    const editor = view();
    if (!editor || !host.current) return;
    const measure = () => {
      if(source.current&&(dragRef.current||indentDrag.current)&&
        (source.current.doc!==editor.state.doc||source.current.from!==editor.state.selection.from||source.current.to!==editor.state.selection.to))cancel();
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
        rtl: getComputedStyle(block).direction === "rtl",
        left:
          (rect.left -
            indent -
            origin.left +
            ((mirrorShiftToPosition(editor, current.before(), current.pos) +
              columnShiftToPosition(
                editor,
                current.before() + 1,
                current.pos,
              )) *
              rect.width) /
              block.offsetWidth) /
          hostScale,
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
  }, [version]);
  const at = (event: React.PointerEvent) => {
    const rect = host.current!.getBoundingClientRect();
    const scale = rect.width / host.current!.offsetWidth;
    const distance =
      ((event.clientX - rect.left) / scale - geometry.left) / geometry.unit;
    return Math.max(
      0.5,
      Math.min(
        1440,
        Math.round(
          (geometry.rtl
            ? geometry.width / geometry.unit - distance
            : distance) * (event.altKey ? 100 : 2),
        ) / (event.altKey ? 100 : 2),
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
  const leading = geometry.rtl ? "rightIndent" : "leftIndent";
  const value = (key: string) => {
    const property = key === "hangingIndent" ? leading : key;
    return indentPreview[property] ?? Number(paragraph[property] || 0);
  };
  const bodyWidth = geometry.width / geometry.unit;
  const tickStep = rulerTickStep(unit, geometry.unit);
  const tickPoints = tickStep * layoutUnits[unit];
  const measurement = (points: number) => `${displayPoints(points, unit)} ${unit}`;
  const indentPosition = (key: string, v: number) =>
    key === "rightIndent" || (key === "hangingIndent" && geometry.rtl)
      ? bodyWidth - v
      : key === "firstLineIndent"
        ? geometry.rtl
          ? bodyWidth - value("rightIndent") - v
          : value("leftIndent") + v
        : v;
  const indentValue = (key: string, event: React.PointerEvent) => {
    const rect = host.current!.getBoundingClientRect();
    const x =
      ((event.clientX - rect.left) / (rect.width / host.current!.offsetWidth) -
        geometry.left) /
      geometry.unit;
    return Math.max(
      -maximumParagraphIndent,
      Math.min(
        maximumParagraphIndent,
        Math.round(
          (key === "rightIndent" || (key === "hangingIndent" && geometry.rtl)
            ? bodyWidth - x
            : key === "firstLineIndent"
              ? geometry.rtl
                ? bodyWidth - x - value("rightIndent")
                : x - value("leftIndent")
              : x) * (event.altKey ? 100 : 2),
        ) / (event.altKey ? 100 : 2),
      ),
    );
  };
  const guidePoint = drag ? (geometry.rtl ? bodyWidth - drag.position : drag.position)
    : indentDrag.current ? indentPosition(indentDrag.current.key, value(indentDrag.current.key)) : null;
  const bounds = host.current?.getBoundingClientRect();
  const screenScale = bounds && host.current ? bounds.width / host.current.offsetWidth : 1;
  const guideX = bounds && guidePoint !== null ? bounds.left + (geometry.left + guidePoint * geometry.unit) * screenScale : null;
  const guideText = drag?.outside ? "Remove tab" : measurement(drag?.position ?? indentDrag.current?.value ?? 0);
  return (
    <div
      className="paragraph-ruler"
      ref={host}
      aria-label={`Paragraph ruler in ${unit}`}
    >
      {guideX !== null && bounds && createPortal(<div className="ruler-drag-guide" style={{left: guideX, top: bounds.bottom,
        height: Math.max(0, (view()?.dom.closest(".editor-scroll")?.getBoundingClientRect().bottom ?? bounds.bottom) - bounds.bottom)}}>
        <output>{guideText}</output>
      </div>, document.body)}
      <select className="ruler-tab-selector" aria-label="New tab alignment" value={tabAlign}
        onChange={event => setTabAlign(event.target.value as typeof tabAlign)}>
        <option value="left">Left</option><option value="center">Centre</option>
        <option value="right">Right</option><option value="decimal">Decimal</option><option value="bar">Bar</option>
        <option value="firstLineIndent">First line</option><option value="hangingIndent">Hanging</option>
      </select>
      <div
        className="ruler-track"
        style={{ left: geometry.left, width: geometry.width }}
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget || event.button !== 0)
            return;
          event.preventDefault();
          const position = at(event);
          if (tabAlign === "hangingIndent") { onHanging(Math.min(maximumParagraphIndent,position),geometry.rtl); return; }
          if (tabAlign === "firstLineIndent") { onFormat({firstLineIndent:Math.max(-maximumParagraphIndent,Math.min(maximumParagraphIndent,position-value(leading)))}); return; }
          if (stops.length < 64 && !stops.some((s) => s.position === position))
            onChange(
              [
                ...stops,
                { position, align: tabAlign, leader: "none" as const },
              ].sort((a, b) => a.position - b.position),
            );
        }}
      >
        {(
          [
            ["leftIndent", "Left indent"],
            ["firstLineIndent", "First line indent"],
            ["hangingIndent", "Hanging indent"],
            ["rightIndent", "Right indent"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`ruler-indent ruler-indent-${key}`}
            aria-label={`${label}: ${measurement(value(key))}`}
            title={`${label}: ${measurement(value(key))}. Alt for fine adjustment. Double-click for paragraph settings.`}
            data-mixed={paragraph[key === "hangingIndent" ? leading : key] === null || undefined}
            style={{ left: indentPosition(key, value(key)) * geometry.unit }}
            onDoubleClick={onProperties}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              captureSource();
              indentDrag.current = { key, value: value(key) };
            }}
            onPointerMove={(e) => {
              if (!indentDrag.current) return;
              const next = indentValue(key, e);
              indentDrag.current = { key, value: next };
              setIndentPreview(rulerIndentChange(key, next, paragraph, geometry.rtl));
            }}
            onPointerUp={(e) => {
              if (!indentDrag.current) return;
              const next = indentDrag.current.value;
              indentDrag.current = null;
              setIndentPreview({});
              e.currentTarget.releasePointerCapture(e.pointerId);
              if (key === "hangingIndent") onHanging(next, geometry.rtl);
              else onFormat({ [key]: next });
            }}
            onLostPointerCapture={cancel}
            onPointerCancel={() => {
              indentDrag.current = null;
              setIndentPreview({});
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                indentDrag.current = null;
                setIndentPreview({});
                return;
              }
              if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
              e.preventDefault();
              const next =
                value(key) +
                (e.key === "ArrowRight" ? 1 : -1) *
                  (key === "rightIndent" ||
                  (key === "hangingIndent" && geometry.rtl) ||
                  (key === "firstLineIndent" && geometry.rtl)
                    ? -1
                    : 1) *
                  (e.shiftKey ? 10 : 1);
              if (key === "hangingIndent") onHanging(Math.max(-maximumParagraphIndent, Math.min(maximumParagraphIndent, next)), geometry.rtl);
              else onFormat({ [key]: Math.max(-maximumParagraphIndent, Math.min(maximumParagraphIndent, next)) });
              e.currentTarget.focus({preventScroll:true});
            }}
          />
        ))}
        {Array.from({length: Math.floor(bodyWidth / (tickPoints / 5)) + 1}, (_, i) => i % 5 !== 0 &&
          <span key={`minor-${i}`} className="ruler-tick ruler-tick-minor" aria-hidden="true"
            style={{left: geometry.rtl ? geometry.width - i * tickPoints / 5 * geometry.unit : i * tickPoints / 5 * geometry.unit}} />)}
        {Array.from(
          { length: Math.floor(bodyWidth / tickPoints) + 1 },
          (_, i) => (
            <span
              className="ruler-tick"
              key={i}
              style={{
                left: geometry.rtl
                  ? geometry.width - i * tickPoints * geometry.unit
                  : i * tickPoints * geometry.unit,
              }}
              aria-hidden="true"
            >
              {displayPoints(i * tickPoints, unit)}
            </span>
          ),
        )}
        {Array.from({length:Math.floor(bodyWidth/defaultInterval)},(_,i)=>(i+1)*defaultInterval)
          .filter(position=>position>(stops.filter(s=>s.align!=="bar").at(-1)?.position||0))
          .map(position=><span key={`default-${position}`} className="ruler-default-tab" aria-hidden="true"
            style={{left:(geometry.rtl?bodyWidth-position:position)*geometry.unit}} />)}
        {stops.map((stop, i) => (
          <button
            key={i}
            type="button"
            className={`ruler-tab ruler-tab-${stop.align}${drag?.index === i && drag.outside ? " is-removing" : ""}`}
            data-mixed={mixed || undefined}
            aria-label={`${stop.align} tab at ${measurement(stop.position)}`}
            title={`${measurement(stop.position)} · ${stop.align} tab. Drag off the ruler or press Delete to remove.`}
            onDoubleClick={onProperties}
            style={{
              left: geometry.rtl
                ? geometry.width -
                  (drag?.index === i ? drag.position : stop.position) *
                    geometry.unit
                : (drag?.index === i ? drag.position : stop.position) *
                  geometry.unit,
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              captureSource();
              dragRef.current = { index: i, position: stop.position };
              setDrag(dragRef.current);
            }}
            onPointerMove={(event) => {
              if (!dragRef.current) return;
              const rect = host.current!.getBoundingClientRect();
              dragRef.current = { index: i, position: at(event), outside: event.clientY < rect.top - 12 || event.clientY > rect.bottom + 12 };
              setDrag(dragRef.current);
            }}
            onPointerUp={(event) => {
              if (!dragRef.current) return;
              const position = dragRef.current.position;
              const bounds = host.current!.getBoundingClientRect();
              const outside = event.clientY < bounds.top - 12 || event.clientY > bounds.bottom + 12;
              dragRef.current = null;
              setDrag(null);
              event.currentTarget.releasePointerCapture(event.pointerId);
              if (outside || position !== stop.position) change(i, outside ? undefined : position);
            }}
            onLostPointerCapture={cancel}
            onPointerCancel={() => {
              dragRef.current = null;
              setDrag(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                dragRef.current = null;
                setDrag(null);
                return;
              }
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
                          (geometry.rtl ? -1 : 1) *
                          (event.shiftKey ? 10 : 1),
                    ),
                  ),
                );
                event.currentTarget.focus({preventScroll:true});
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
