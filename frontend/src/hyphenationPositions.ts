/** Immutable paragraph-local break sets. Moving a paragraph's document offset
 * must not require copying/mapping every discretionary break in that paragraph. */
export type HyphenationPositions = readonly {
  from: number;
  points: ReadonlySet<number>;
}[];

export function hasHyphenationPosition(
  entries: HyphenationPositions,
  position: number,
) {
  let low = 0,
    high = entries.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (entries[middle].from <= position) low = middle + 1;
    else high = middle - 1;
  }
  return high >= 0 && entries[high].points.has(position - entries[high].from);
}

/** Same-document dictionary/style updates need reflow only where breaks changed.
 * Ordinary typing stores a new index and is already covered by the document diff. */
export function changedHyphenationPositions(
  before: HyphenationPositions,
  after: HyphenationPositions,
) {
  let a = 0,
    b = 0,
    from = Infinity,
    to = -Infinity;
  const add = (
    origin: number,
    points: ReadonlySet<number>,
    other?: ReadonlySet<number>,
  ) => {
    if (points === other) return;
    for (const point of points)
      if (!other?.has(point)) {
        from = Math.min(from, origin + point);
        to = Math.max(to, origin + point);
      }
  };
  while (a < before.length || b < after.length) {
    const old = before[a],
      next = after[b];
    if (old && next && old.from === next.from) {
      add(old.from, old.points, next.points);
      add(next.from, next.points, old.points);
      a++;
      b++;
    } else if (old && (!next || old.from < next.from)) {
      add(old.from, old.points);
      a++;
    } else {
      add(next.from, next.points);
      b++;
    }
  }
  return from === Infinity ? null : { from, to };
}
