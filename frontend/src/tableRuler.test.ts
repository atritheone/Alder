import { describe, it, expect } from "vitest";
import { resizeTableBoundary, tableBoundaryPositions } from "./tableRuler";
describe("table ruler boundaries", () => {
  it("moves interior boundaries without changing total width or unrelated columns", () => {
    expect(resizeTableBoundary([100, 200, 80], 1, 12.5, "left", 600)).toEqual([
      112.5, 187.5, 80,
    ]);
    expect(resizeTableBoundary([100, 200, 80], 1, 900, "left", 600)).toEqual([
      275, 25, 80,
    ]);
    expect(resizeTableBoundary([100, 200, 80], 1, -900, "left", 600)).toEqual([
      25, 275, 80,
    ]);
  });
  it("resizes the free edge, respecting alignment and available width", () => {
    expect(resizeTableBoundary([100, 200], 0, 10, "left", 600)).toBeNull();
    expect(resizeTableBoundary([100, 200], 2, 10, "right", 600)).toBeNull();
    expect(resizeTableBoundary([100, 200], 0, -10, "right", 600)).toEqual([
      110, 200,
    ]);
    expect(resizeTableBoundary([100, 200], 2, 1000, "left", 400)).toEqual([
      100, 300,
    ]);
    expect(resizeTableBoundary([100, 200], 2, 10, "center", 600)).toEqual([
      100, 220,
    ]);
    expect(tableBoundaryPositions([100, 220], [100, 200], "center")).toEqual([
      -10, 90, 310,
    ]);
    expect(tableBoundaryPositions([110, 200], [100, 200], "right")).toEqual([
      -10, 100, 300,
    ]);
  });
  it("allows reducing imported overflowing tables without growing them further", () => {
    expect(resizeTableBoundary([100, 500], 2, 10, "left", 400)).toEqual([
      100, 500,
    ]);
    expect(resizeTableBoundary([100, 500], 2, -50, "left", 400)).toEqual([
      100, 450,
    ]);
    expect(resizeTableBoundary([100, 500], 2, NaN, "left", 400)).toBeNull();
  });
});
