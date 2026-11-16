import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EditorView } from "prosemirror-view";
import { pageFrame, documentCanvasWidth } from "./sectionLayout";
import { pageAtPosition, type FlowPage, type PageLayout } from "./pageFlow";
import { pageInsets, type PageSettings } from "./pageGeometry";
import { mirroredPageLayout, isMirroredPage } from "./mirroredMargins";
import {
  displayPoints,
  layoutUnits,
  rulerTickStep,
  useLayoutUnit,
} from "./layoutUnits";
import { projectText, projectionPosition } from "./textProjection";
import { useStoredPreference } from "./useStoredPreference";
import {
  storyVariant,
  type RunningMatter,
  type StoryPart,
  type StoryVariant,
} from "./runningMatter";
import ColumnRulerControls from "./ColumnRulerControls";
import TableRulerControls from "./TableRulerControls";
import type { Command } from "prosemirror-state";

export function useVerticalRuler() {
  const [value, setValue] = useStoredPreference(
    "alder.ruler.vertical",
    "false",
  );
  return [value === "true", () => setValue(String(value !== "true"))] as const;
}
type Edge = "top" | "bottom" | "left" | "right";
type Handle = Edge | StoryPart;
type Geometry = {
  left: number;
  top: number;
  width: number;
  height: number;
  scale: number;
  clip: { left: number; top: number; right: number; bottom: number };
  horizontalTop?: number;
  horizontalHeight: number;
  margins: Record<Edge, number>;
  storyHeights: Record<StoryPart, number>;
  layout: PageLayout;
  page: number;
  position: number;
  mirrored: boolean;
};

/** View-only page geometry. Coordinates come from the same frames as page sheets. */
export default function PageRulers({
  view,
  layout,
  pages,
  horizontal,
  vertical,
  version,
  readingOffset,
  onChange,
  onRunningChange,
  onProperties,
  onTableCommand,
  onTableProperties,
}: {
  view: () => EditorView | null;
  layout: PageLayout;
  pages: FlowPage[];
  horizontal: boolean;
  vertical: boolean;
  version: unknown;
  readingOffset?: number;
  onChange: (position: number, patch: PageSettings) => void;
  onRunningChange: (position: number, patch: RunningMatter) => void;
  onTableCommand: (command: Command) => void;
  onTableProperties: () => void;
  onProperties: (
    position: number,
    part?: StoryPart,
    variant?: StoryVariant,
  ) => void;
}) {
  const [unit] = useLayoutUnit();
  const doc = view()?.state.doc;
  const canvasWidth = useMemo(
    () => (doc ? documentCanvasWidth(doc, layout) : layout.width),
    [doc, layout.width, layout.columnSource],
  );
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [preview, setPreview] = useState<{ edge: Handle; px: number } | null>(
    null,
  );
  const held = useRef<{
    edge: Handle;
    px: number;
    geometry: Geometry;
    doc: unknown;
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
      canvas = v?.dom.closest<HTMLElement>(".flow-canvas"),
      scroll = v?.dom.closest<HTMLElement>(".editor-scroll");
    if (!v || !canvas || !scroll || !pages.length) return;
    const measure = () => {
      if (held.current && held.current.doc !== v.state.doc) cancel();
      const position =
        readingOffset == null
          ? v.state.selection.from
          : projectionPosition(projectText(v.state.doc), readingOffset);
      const page = pageAtPosition(pages, position) ?? 0,
        frame = pageFrame(pages, page, layout);
      const active = mirroredPageLayout(frame.layout, page),
        rect = canvas.getBoundingClientRect(),
        clip = scroll.getBoundingClientRect();
      const scale = rect.width / canvasWidth;
      const ruler = v.dom
        .closest(".editor-shell")
        ?.querySelector(".paragraph-ruler")
        ?.getBoundingClientRect();
      const margins = pageInsets(active);
      const sheet = canvas.querySelectorAll(".page-sheet")[page];
      const storyHeights = { header: 0, footer: 0 };
      for (const part of ["header", "footer"] as const)
        storyHeights[part] =
          (sheet
            ?.querySelector(`[data-running-story="${part}"]`)
            ?.getBoundingClientRect().height || 0) / scale;
      const next: Geometry = {
        left: rect.left + frame.left * scale,
        top: rect.top + frame.top * scale,
        width: active.width * scale,
        height: active.height * scale,
        scale,
        margins,
        storyHeights,
        layout: frame.layout,
        page,
        position,
        mirrored: isMirroredPage(frame.layout, page),
        clip: {
          left: clip.left,
          top: clip.top,
          right: clip.right,
          bottom: clip.bottom,
        },
        horizontalTop: horizontal ? ruler?.top : undefined,
        horizontalHeight: ruler?.height || 28,
      };
      if (
        held.current &&
        ["left", "top", "scale", "position", "page"].some(
          (key) =>
            held.current!.geometry[key as keyof Geometry] !==
            next[key as keyof Geometry],
        )
      )
        cancel();
      setGeometry((old) =>
        old &&
        old.layout === next.layout &&
        [
          "left",
          "top",
          "width",
          "height",
          "scale",
          "page",
          "position",
          "horizontalTop",
          "horizontalHeight",
          "mirrored",
        ].every(
          (key) => old[key as keyof Geometry] === next[key as keyof Geometry],
        ) &&
        JSON.stringify(old.clip) === JSON.stringify(next.clip) &&
        JSON.stringify(old.margins) === JSON.stringify(next.margins) &&
        JSON.stringify(old.storyHeights) === JSON.stringify(next.storyHeights)
          ? old
          : next,
      );
    };
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    scroll.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(scroll);
    observer.observe(canvas);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scroll.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [
    version,
    layout,
    pages,
    horizontal,
    vertical,
    readingOffset,
    canvasWidth,
  ]);
  if (!geometry) return null;
  const g = geometry;
  const story = (edge: Handle): edge is StoryPart =>
    edge === "header" || edge === "footer";
  const distance = (edge: Handle) =>
    story(edge)
      ? ((g.layout.runningMatter?.[
          edge === "header" ? "headerDistanceMm" : "footerDistanceMm"
        ] ?? 10) *
          96) /
        25.4
      : g.margins[edge];
  const limit = (edge: Handle, px: number) => {
    if (story(edge))
      return Math.max(
        0,
        Math.min(
          (100 * 96) / 25.4,
          g.margins[edge === "header" ? "top" : "bottom"] -
            g.storyHeights[edge] -
            4,
          px,
        ),
      );
    const opposite: Edge = (
      { top: "bottom", bottom: "top", left: "right", right: "left" } as const
    )[edge];
    const extent =
      edge === "left" || edge === "right" ? g.layout.width : g.layout.height;
    const binding =
      edge === (g.mirrored ? "right" : "left") ? g.layout.gutter || 0 : 0;
    return Math.max(
      binding,
      Math.min(
        (100 * 96) / 25.4 + binding,
        extent - g.margins[opposite] - (20 * 96) / 25.4,
        px,
      ),
    );
  };
  const commit = (edge: Handle, px: number) => {
    if (story(edge)) {
      onRunningChange(g.position, {
        [edge === "header" ? "headerDistanceMm" : "footerDistanceMm"]:
          (px * 25.4) / 96,
      });
      return;
    }
    const actual =
      g.mirrored && (edge === "left" || edge === "right")
        ? edge === "left"
          ? "right"
          : "left"
        : edge;
    const key = `margin${actual[0].toUpperCase()}${actual.slice(1)}Mm`;
    onChange(g.position, {
      [key]:
        ((px - (actual === "left" ? g.layout.gutter || 0 : 0)) * 25.4) / 96,
    });
  };
  const margin = (edge: Handle) =>
    preview?.edge === edge ? preview.px : distance(edge);
  const handle = (edge: Handle, style: React.CSSProperties) => {
    const physical = margin(edge),
      side = g.layout.mirrorMargins && (edge === 'left' || edge === 'right')
        ? edge === (g.mirrored ? 'right' : 'left') ? 'Inside' : 'Outside'
        : edge[0].toUpperCase() + edge.slice(1),
      label = `${side} ${story(edge) ? "distance" : "page margin"}`;
    return (
      <button
        key={edge}
        type="button"
        className={`page-ruler-margin page-ruler-margin-${edge}`}
        style={style}
        aria-label={`${label}: ${displayPoints(physical * 0.75, unit)} ${unit}`}
        title={`${label}. Drag to change this section; double-click for page settings.`}
        onFocus={(event) => {
          const scroll = view()?.dom.closest<HTMLElement>(".editor-scroll");
          if (!scroll) return;
          const rect = event.currentTarget.getBoundingClientRect(),
            bounds = scroll.getBoundingClientRect();
          const scale = bounds.width / scroll.offsetWidth;
          const vertical = edge !== "left" && edge !== "right";
          const delta = vertical
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
              [vertical ? "top" : "left"]: delta / scale,
              behavior: "instant",
            });
        }}
        onDoubleClick={() =>
          onProperties(
            g.position,
            story(edge) ? edge : undefined,
            g.layout.runningMatter
              ? storyVariant(
                  g.layout.runningMatter,
                  g.page,
                  g.layout.sectionStartPage || 0,
                )
              : "default",
          )
        }
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          held.current = {
            edge,
            px: physical,
            geometry: g,
            doc: view()?.state.doc,
          };
        }}
        onPointerMove={(e) => {
          if (!held.current) return;
          const horizontal = edge === "left" || edge === "right";
          const distance =
            (horizontal ? e.clientX - g.left : e.clientY - g.top) / g.scale;
          const px =
            edge === "right"
              ? g.layout.width - distance
              : edge === "bottom" || edge === "footer"
                ? g.layout.height - distance
                : distance;
          const step = e.altKey ? 0.01 : 96 / 25.4 / 2;
          const bounded = limit(edge, Math.round(px / step) * step);
          held.current.px = bounded;
          setPreview({ edge, px: bounded });
        }}
        onPointerUp={(e) => {
          const current = held.current;
          if (!current) return;
          cancel();
          e.currentTarget.releasePointerCapture(e.pointerId);
          if (
            view()?.state.doc === current.doc &&
            current.px !== distance(edge)
          )
            commit(edge, current.px);
        }}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
        onKeyDown={(e) => {
          if (
            !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
          )
            return;
          e.preventDefault();
          const direction =
            (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1) *
            (edge === "right" || edge === "bottom" || edge === "footer"
              ? -1
              : 1);
          commit(
            edge,
            limit(edge, physical + (direction * (e.shiftKey ? 10 : 1) * 4) / 3),
          );
        }}
      />
    );
  };
  const tick =
    (rulerTickStep(unit, (g.scale * 4) / 3) * layoutUnits[unit] * 4) / 3;
  return createPortal(
    <div className="page-ruler-layer" aria-label="Page rulers">
      {readingOffset == null && (
        <TableRulerControls
          view={view}
          version={version}
          scale={g.scale}
          clip={g.clip}
          horizontalTop={horizontal ? g.horizontalTop : undefined}
          vertical={vertical}
          pageTop={g.top + g.margins.top * g.scale}
          pageBottom={g.top + g.height - g.margins.bottom * g.scale}
          onCommand={onTableCommand}
          onProperties={onTableProperties}
        />
      )}
      {horizontal && g.horizontalTop != null && (
        <div
          className="page-ruler-horizontal"
          style={{
            left: g.clip.left,
            top: g.horizontalTop,
            width: g.clip.right - g.clip.left,
            height: g.horizontalHeight,
          }}
        >
          <span
            className="page-ruler-shade"
            style={{
              left: g.left - g.clip.left,
              width: margin("left") * g.scale,
            }}
          />
          <span
            className="page-ruler-shade"
            style={{
              left: g.left - g.clip.left + g.width - margin("right") * g.scale,
              width: margin("right") * g.scale,
            }}
          />
          {handle("left", {
            left: g.left - g.clip.left + margin("left") * g.scale,
          })}
          {handle("right", {
            left: g.left - g.clip.left + g.width - margin("right") * g.scale,
          })}
          {g.layout.columns && g.layout.columns.count > 1 && (
            <ColumnRulerControls
              columns={g.layout.columns}
              body={g.layout.width - g.margins.left - g.margins.right}
              left={g.left + g.margins.left * g.scale}
              origin={g.clip.left}
              scale={g.scale}
              top={g.clip.top}
              bottom={g.clip.bottom}
              version={version}
              onChange={(columns) => onChange(g.position, { columns })}
              onProperties={() => onProperties(g.position)}
            />
          )}
        </div>
      )}
      {vertical && (
        <div
          className="page-ruler-vertical"
          style={{
            left: g.clip.left,
            top: g.clip.top,
            height: g.clip.bottom - g.clip.top,
          }}
        >
          <div
            className="page-ruler-vertical-track"
            style={{ top: g.top - g.clip.top, height: g.height }}
          >
            <span
              className="page-ruler-shade"
              style={{ top: 0, height: margin("top") * g.scale }}
            />
            <span
              className="page-ruler-shade"
              style={{ bottom: 0, height: margin("bottom") * g.scale }}
            />
            {Array.from(
              {
                length:
                  Math.floor((g.layout.height - g.margins.top) / tick) + 1,
              },
              (_, i) => (
                <span
                  className="page-ruler-vertical-tick"
                  key={i}
                  style={{ top: (g.margins.top + i * tick) * g.scale }}
                >
                  {displayPoints(i * tick * 0.75, unit)}
                </span>
              ),
            )}
            {handle("top", { top: margin("top") * g.scale })}
            {handle("bottom", { top: g.height - margin("bottom") * g.scale })}
            {g.layout.runningMatter && (
              <>
                {handle("header", { top: margin("header") * g.scale })}
                {handle("footer", {
                  top: g.height - margin("footer") * g.scale,
                })}
              </>
            )}
          </div>
        </div>
      )}
      {preview && (
        <output
          className="page-ruler-readout"
          style={{ left: g.clip.left + 30, top: g.clip.top + 4 }}
        >
          {displayPoints(preview.px * 0.75, unit)} {unit} · This section
        </output>
      )}
    </div>,
    document.body,
  );
}
