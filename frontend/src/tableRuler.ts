/** Resize a physical grid boundary. Interior boundaries retain the table width;
 * the free outside edge grows/shrinks the table according to its alignment. */
export function resizeTableBoundary(
  widths: number[],
  boundary: number,
  delta: number,
  align: string,
  available: number,
): number[] | null {
  if (
    !widths.length ||
    widths.some((w) => !Number.isFinite(w) || w < 25 || w > 10000) ||
    !Number.isInteger(boundary) ||
    boundary < 0 ||
    boundary > widths.length ||
    !Number.isFinite(delta) ||
    !Number.isFinite(available)
  )
    return null;
  const next = [...widths],
    total = widths.reduce((a, b) => a + b, 0);
  if (boundary > 0 && boundary < widths.length) {
    const change = Math.max(
      25 - widths[boundary - 1],
      Math.min(widths[boundary] - 25, delta),
    );
    next[boundary - 1] += change;
    next[boundary] -= change;
  } else {
    if (
      (boundary === 0 && align === "left") ||
      (boundary === widths.length && align === "right")
    )
      return null;
    const index = boundary === 0 ? 0 : widths.length - 1;
    const change =
      delta * (boundary === 0 ? -1 : 1) * (align === "center" ? 2 : 1);
    next[index] += Math.max(
      25 - widths[index],
      Math.min(
        Math.max(total, available) - total,
        10000 - widths[index],
        change,
      ),
    );
  }
  return next;
}

export function tableBoundaryPositions(
  widths: number[],
  original: number[],
  align: string,
) {
  const total = widths.reduce((a, b) => a + b, 0),
    oldTotal = original.reduce((a, b) => a + b, 0);
  let position =
    (oldTotal - total) * (align === "center" ? 0.5 : align === "right" ? 1 : 0);
  return [position, ...widths.map((width) => (position += width))];
}
