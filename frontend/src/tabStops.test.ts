import { describe, it, expect } from "vitest";
import { nextTab, validTabStops, cssTabStops, tabStopsCSS } from "./tabStops";
describe("paragraph tab stops", () => {
  it("prints bars without consuming a tab or changing default text stops",()=>{
    const bars=[{position:144,align:"bar" as const,leader:"none" as const}];
    expect(validTabStops(bars)).toBe(true);
    expect(nextTab(bars,10,20,8)).toMatchObject({position:36,align:"left",gap:26});
    expect(nextTab(bars,10,20,8,48).position).toBe(48);
    expect(validTabStops([{...bars[0],leader:"dot"}])).toBe(false);
  });
  it("aligns following text and resumes half-inch defaults after custom stops", () => {
    const stops = [
      { position: 72, align: "right" as const, leader: "dot" as const },
    ];
    expect(nextTab(stops, 10, 20, 8).gap).toBe(42);
    expect(nextTab(stops, 70, 20, 8).position).toBe(108);
    expect(nextTab([{ ...stops[0], align: "decimal" }], 10, 20, 8).gap).toBe(
      54,
    );
    expect(nextTab([{ ...stops[0], align: "center" }], 10, 20, 8).gap).toBe(52);
  });
  it("accepts explicit defaults and rejects ambiguous or unsafe definitions", () => {
    expect(validTabStops([])).toBe(true);
    expect(
      validTabStops([{ position: NaN, align: "left", leader: "none" }]),
    ).toBe(false);
    expect(
      validTabStops([
        { position: 10, align: "left", leader: "none" },
        { position: 10, align: "right", leader: "dot" },
      ]),
    ).toBe(false);
    const stops = [
      { position: 72, align: "left" as const, leader: "dot" as const },
    ];
    expect(cssTabStops(tabStopsCSS(stops))).toEqual(stops);
  });
});
