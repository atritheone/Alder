import { describe, it, expect } from "vitest";
import { fitColumnWidths } from "./tableAutoFit";
describe("content column fitting", () => {
  it("retains natural widths when content fits", () =>
    expect(fitColumnWidths([30.2, 200, 18], 600)).toEqual([31, 200, 25]));
  it("shares available width above minimum sizes without overflow", () => {
    const widths = fitColumnWidths([30, 600, 100], 400)!;
    expect(widths.reduce((a, b) => a + b, 0)).toBe(400);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(25);
    expect(widths[1]).toBeGreaterThan(widths[2] * 3);
  });
  it("refuses impossible tables and handles zero spare space", () => {
    expect(fitColumnWidths([90, 200], 49)).toBeNull();
    expect(fitColumnWidths([90, 200], 50)).toEqual([25, 25]);
  });
});
