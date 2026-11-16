/** Equal-width columns keep the body width fixed while their shared gap changes. */
export function columnRulerEdges(body: number, count: number, gap: number) {
  if (count < 2) return [];
  return Array.from({ length: count - 1 }, (_, i) =>
    ["left", "right"].map((side) => {
      const factor =
        side === "left" ? (i - count + 1) / count : (i + 1) / count;
      const base = ((i + 1) * body) / count;
      return { index: i, side, base, factor, position: base + factor * gap };
    }),
  ).flat();
}
export function columnGapAt(
  position: number,
  edge: { base: number; factor: number },
  body: number,
  count: number,
) {
  return Math.max(
    0,
    Math.min(
      (100 * 96) / 25.4,
      (body - (count * 20 * 96) / 25.4) / (count - 1),
      (position - edge.base) / edge.factor,
    ),
  );
}
