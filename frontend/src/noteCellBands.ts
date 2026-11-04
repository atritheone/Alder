type Bounds = { top: number; bottom: number };
export type CellInk = Bounds & { lane: string };
export type CellBand = Bounds & { members?: Set<number> };

/** Unequal cell leading can form an endless chain of overlapping lines. Each
 * cell's own line stays indivisible; a page boundary may leave different cells
 * at different vertical positions. The next fragment resets their origins. */
export function splitNoteCellBands(
  bands: Bounds[],
  inks: CellInk[],
  maximum: number,
  keeps: (Bounds & { lane?: string })[] = [],
  repeatHeight = 0,
): CellBand[] {
  let used = 0;
  return bands.flatMap((band) => {
    const height = band.bottom - band.top;
    if (height <= maximum - repeatHeight + 0.01) {
      used = (used + height <= maximum + 0.01 ? used : repeatHeight) + height;
      return [band];
    }
    type Unit = Bounds & { members: Set<number> };
    const lanes = new Map<string, Unit[]>();
    inks.forEach((ink, index) => {
      if (ink.top < band.top - 0.1 || ink.top >= band.bottom - 0.1) return;
      const lane = lanes.get(ink.lane) || [];
      lane.push({ ...ink, members: new Set([index]) });
      lanes.set(ink.lane, lane);
    });
    for (const keep of keeps) {
      if (
        !keep.lane ||
        keep.top < band.top - 0.1 ||
        keep.bottom > band.bottom + 0.1
      )
        continue;
      const lane = lanes.get(keep.lane) || [];
      lane.push({ ...keep, members: new Set() });
      lanes.set(keep.lane, lane);
    }
    const units: Unit[] = [];
    for (const lane of lanes.values()) {
      const groups: Unit[] = [];
      for (const item of lane.sort((a, b) => a.top - b.top)) {
        const last = groups.at(-1);
        if (last && item.top < last.bottom - 0.1) {
          last.bottom = Math.max(last.bottom, item.bottom);
          item.members.forEach((i) => last.members.add(i));
        } else groups.push({ ...item, members: new Set(item.members) });
      }
      units.push(...groups);
    }
    for (const keep of keeps) {
      if (
        keep.lane ||
        keep.top < band.top - 0.1 ||
        keep.bottom > band.bottom + 0.1
      )
        continue;
      const members = new Set<number>();
      let top = keep.top,
        bottom = keep.bottom;
      for (let i = units.length - 1; i >= 0; i--) {
        if (
          units[i].top >= keep.top - 0.1 &&
          units[i].top < keep.bottom - 0.1
        ) {
          const [unit] = units.splice(i, 1);
          top = Math.min(top, unit.top);
          bottom = Math.max(bottom, unit.bottom);
          unit.members.forEach((index) => members.add(index));
        }
      }
      units.push({ top, bottom, members });
    }
    const result: CellBand[] = [];
    const capacities: number[] = [];
    let capacity = maximum - used,
      base = used;
    for (const unit of units.sort((a, b) => a.top - b.top)) {
      const last = result.at(-1);
      if (
        last &&
        Math.max(last.bottom, unit.bottom) - last.top <= capacity + 0.01
      ) {
        last.bottom = Math.max(last.bottom, unit.bottom);
        unit.members.forEach((i) => last.members!.add(i));
      } else {
        if (last || unit.bottom - unit.top > capacity + 0.01) {
          base = repeatHeight;
          capacity = maximum - base;
        }
        capacities.push(capacity);
        result.push({ ...unit, members: new Set(unit.members) });
      }
    }
    if (result.length < 2) {
      used = base + height;
      return [band];
    }
    // Keep intervening whitespace when it fits, but never extend a band beyond
    // its printable area merely to reach another cell's later line.
    result.forEach((part, index) => {
      const end = result[index + 1]?.top ?? band.bottom;
      part.bottom = Math.max(
        part.bottom,
        Math.min(end, part.top + capacities[index]),
      );
    });
    used = base + result.at(-1)!.bottom - result.at(-1)!.top;
    return result;
  });
}
