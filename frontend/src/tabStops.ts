export type TabStop = {
  position: number;
  align: "left" | "center" | "right" | "decimal" | "bar";
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
        ["left", "center", "right", "decimal", "bar"].includes(stop.align) &&
        ["none", "dot", "dash", "line"].includes(stop.leader) &&
        (stop.align !== "bar" || stop.leader === "none") &&
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
  defaultInterval = 36,
) {
  const textStops = stops.filter(stop => stop.align !== "bar");
  for (const stop of textStops) {
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
  const interval=Number.isFinite(defaultInterval)&&defaultInterval>0?defaultInterval:36;
  const position =
    (Math.floor(Math.max(x, textStops.at(-1)?.position || 0) / interval) + 1) * interval;
  return {
    position,
    align: "left" as const,
    leader: "none" as const,
    gap: position - x,
  };
}

/** Printed bars are paragraph paint, not tab characters or speech content. */
export function barTabsCSS(stops: TabStop[]) {
  const bars = stops.filter(stop => stop.align === "bar");
  const paint=(direction:string,indent:string)=>bars.map(stop=>{
    const x=`calc(${stop.position}pt - var(${indent},0pt))`;
    const end=`calc(${stop.position+.75}pt - var(${indent},0pt))`;
    return `linear-gradient(${direction},transparent ${x},currentColor ${x},currentColor ${end},transparent ${end})`;
  }).join(",")||"none";
  return `--alder-bars-ltr:${paint("to right","--alder-left-indent")};--alder-bars-rtl:${paint("to left","--alder-right-indent")};background-image:var(--alder-bar-paint,var(--alder-bars-ltr));${bars.length?"--alder-paragraph-paint:1;":""}`;
}
