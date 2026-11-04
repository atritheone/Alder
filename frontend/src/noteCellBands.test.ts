import { expect, it } from "vitest";
import { splitNoteCellBands } from "./noteCellBands";
it("uses space after a heading and picture instead of leaving the first sheet empty", () => {
  const inks = Array.from({ length: 30 }, (_, i) => ({
    top: 32 + i * 8,
    bottom: 42 + i * 8,
    lane: i % 2 ? "a" : "b",
  }));
  const bands = splitNoteCellBands(
    [
      { top: 0, bottom: 20 },
      { top: 20, bottom: 32 },
      { top: 32, bottom: 274 },
    ],
    inks,
    100,
    [],
    20,
  );
  expect(bands[2].bottom - bands[2].top).toBeGreaterThan(50);
  expect(bands[2].bottom - bands[2].top).toBeLessThanOrEqual(68);
  expect(bands.slice(3).every((band) => band.bottom - band.top <= 80)).toBe(
    true,
  );
});
it("splits interleaved cell baselines without cutting or repeating either cell line", () => {
  const inks = [
    ...Array.from({ length: 20 }, (_, i) => ({
      top: i * 18,
      bottom: i * 18 + 17,
      lane: "left",
    })),
    ...Array.from({ length: 30 }, (_, i) => ({
      top: i * 12 + 2,
      bottom: i * 12 + 13,
      lane: "right",
    })),
  ];
  const bands = splitNoteCellBands([{ top: 0, bottom: 365 }], inks, 100);
  expect(bands.length).toBeGreaterThan(3);
  const seen: number[] = [];
  for (const band of bands) {
    expect(band.bottom - band.top).toBeLessThanOrEqual(100.01);
    for (const i of band.members!) {
      expect(inks[i].top).toBeGreaterThanOrEqual(band.top);
      expect(inks[i].bottom).toBeLessThanOrEqual(band.bottom);
      seen.push(i);
    }
  }
  expect(seen.sort((a, b) => a - b)).toEqual(inks.map((_, i) => i));
});
it("keeps overlapping inline runs and pictures together within their own paragraph", () => {
  const inks = [
    { top: 0, bottom: 35, lane: "a" },
    { top: 20, bottom: 40, lane: "a" },
    { top: 30, bottom: 50, lane: "b" },
    { top: 45, bottom: 65, lane: "a" },
    { top: 55, bottom: 75, lane: "b" },
  ];
  const bands = splitNoteCellBands([{ top: 0, bottom: 75 }], inks, 50);
  expect([...bands[0].members!]).toContain(0);
  expect([...bands[0].members!]).toContain(1);
  expect(bands.flatMap((b) => [...b.members!]).sort()).toEqual([0, 1, 2, 3, 4]);
});
it("retains an impossible single-cell object for an explicit overflow error", () => {
  expect(
    splitNoteCellBands(
      [{ top: 0, bottom: 120 }],
      [{ top: 0, bottom: 120, lane: "one" }],
      100,
    ),
  ).toEqual([{ top: 0, bottom: 120 }]);
});
it("honours a bounded keep-together paragraph while splitting parallel content", () => {
  const inks = Array.from({ length: 12 }, (_, i) => ({
    top: i * 10,
    bottom: i * 10 + 12,
    lane: i % 2 ? "a" : "b",
  }));
  const bands = splitNoteCellBands([{ top: 0, bottom: 122 }], inks, 60, [
    { top: 10, bottom: 42, lane: "a" },
  ]);
  expect(bands.some((b) => b.members?.has(1) && b.members.has(3))).toBe(true);
});
