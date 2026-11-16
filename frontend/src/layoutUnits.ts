import { useStoredPreference } from "./useStoredPreference";

export const layoutUnits = { mm: 72 / 25.4, cm: 72 / 2.54, in: 72, pt: 1, pc: 12 };
export type LayoutUnit = keyof typeof layoutUnits;
export function validLayoutUnit(value: string): LayoutUnit {
  return Object.hasOwn(layoutUnits, value) ? (value as LayoutUnit) : "mm";
}
export function displayPoints(points: number, unit: LayoutUnit) {
  return Number((points / layoutUnits[unit]).toFixed(2)).toLocaleString(
    "en-US",
    { maximumFractionDigits: 2 },
  );
}
export function parseMeasurement(
  text: string,
  defaultUnit: LayoutUnit,
): number | null {
  const match = text
    .trim()
    .match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(mm|cm|in|pt|pc|")?$/i);
  if (!match) return null;
  const unit =
    match[2] === '"'
      ? "in"
      : ((match[2]?.toLowerCase() || defaultUnit) as LayoutUnit);
  const points = Number(match[1]) * layoutUnits[unit];
  return Number.isFinite(points) ? points : null;
}
export function rulerTickStep(unit: LayoutUnit, pixelsPerPoint: number) {
  const candidates =
    unit === "in"
      ? [0.125, 0.25, 0.5, 1, 2, 4, 8]
      : [1, 2, 5, 10, 20, 50, 100, 200];
  return (
    candidates.find(
      (step) => step * layoutUnits[unit] * pixelsPerPoint >= 35,
    ) ?? candidates.at(-1)!
  );
}
export function useLayoutUnit() {
  const [value, setValue] = useStoredPreference("alder.layoutUnit", "mm");
  return [validLayoutUnit(value), setValue] as const;
}
