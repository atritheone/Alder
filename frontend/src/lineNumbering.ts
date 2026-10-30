export type LineNumbering = {
  start: number;
  step: number;
  distance: number;
  restart: "newPage" | "newSection" | "continuous";
};
export const defaultLineNumbering: LineNumbering = {
  start: 1,
  step: 1,
  distance: 5,
  restart: "newPage",
};
export function validLineNumbering(
  value: unknown,
): value is LineNumbering | null | undefined {
  if (value == null) return true;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  const n = value as LineNumbering;
  return (
    Object.keys(n).every((k) =>
      ["start", "step", "distance", "restart"].includes(k),
    ) &&
    Number.isInteger(n.start) &&
    n.start >= 1 &&
    n.start <= 32767 &&
    Number.isInteger(n.step) &&
    n.step >= 1 &&
    n.step <= 1000 &&
    typeof n.distance === "number" &&
    Number.isFinite(n.distance) &&
    n.distance >= 0 &&
    n.distance <= 100 &&
    ["newPage", "newSection", "continuous"].includes(n.restart)
  );
}
