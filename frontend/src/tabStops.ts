export type TabStop = {
  position: number;
  align: "left" | "center" | "right" | "decimal";
  leader: "none" | "dot" | "dash" | "line";
};

export function validTabStops(value: unknown): value is TabStop[] {
  return (
    Array.isArray(value) &&
    value.length <= 64 &&
    value.every(
      (stop, i) =>
        stop &&
        typeof stop.position === "number" &&
        Number.isFinite(stop.position) &&
        stop.position > 0 &&
        stop.position <= 1440 &&
        ["left", "center", "right", "decimal"].includes(stop.align) &&
        ["none", "dot", "dash", "line"].includes(stop.leader) &&
        (!i || value[i - 1].position < stop.position),
    )
  );
}

export function parseTabStops(value: string | null): TabStop[] | null {
  if (value == null) return null;
  try {
    const stops: unknown = JSON.parse(value);
    return validTabStops(stops) ? stops : null;
  } catch {
    return null;
  }
}

export function tabStopsCSS(stops: TabStop[]): string {
  return (
    stops.map((s) => `${s.position} ${s.align} ${s.leader}`).join(",") || "none"
  );
}

export function cssTabStops(value: string): TabStop[] {
  if (!value.trim() || value.trim() === "none") return [];
  const stops = value
    .trim()
    .split(",")
    .map((item) => {
      const [position, align, leader] = item.trim().split(/\s+/);
      return { position: Number(position), align, leader };
    });
  return validTabStops(stops) ? stops : [];
}

/** All distances here are points. Defaults resume after the last custom stop. */
export function nextTab(
  stops: TabStop[],
  x: number,
  width: number,
  decimalWidth: number,
) {
  for (const stop of stops) {
    if (stop.position <= x + 0.1) continue;
    const offset =
      stop.align === "right"
        ? width
        : stop.align === "center"
          ? width / 2
          : stop.align === "decimal"
            ? decimalWidth
            : 0;
    if (stop.position - offset > x + 0.1)
      return { ...stop, gap: stop.position - offset - x };
  }
  const position =
    (Math.floor(Math.max(x, stops.at(-1)?.position || 0) / 36) + 1) * 36;
  return {
    position,
    align: "left" as const,
    leader: "none" as const,
    gap: position - x,
  };
}
