import { expect, it } from "vitest";
import { rulerIndentChange, maximumParagraphIndent } from "./rulerIndents";
import { parseMeasurement, rulerTickStep, layoutUnits } from "./layoutUnits";
import { resolveStyles, styleDeclarations } from "./styleResolution";

it("retains wide physical indents in styles and painting",()=>{
  const style=resolveStyles([{id:'wide',name:'Wide',kind:'paragraph',leftIndent:240,firstLineIndent:-180}]).get('wide')!;
  expect(style.leftIndent).toBe(240);
  expect(styleDeclarations(style,'paragraph')).toContain('margin-left:240pt');
  expect(styleDeclarations(style,'paragraph')).toContain('text-indent:-180pt');
  expect(rulerIndentChange('hangingIndent',250,style,false)).toEqual({leftIndent:250,firstLineIndent:-190});
});

it("moves the hanging edge while retaining the first line in LTR and RTL paragraphs", () => {
  expect(rulerIndentChange("hangingIndent", 36, {leftIndent: 12, firstLineIndent: 24}, false))
    .toEqual({leftIndent: 36, firstLineIndent: 0});
  expect(rulerIndentChange("hangingIndent", 36, {rightIndent: 12, firstLineIndent: 0}, true))
    .toEqual({rightIndent: 36, firstLineIndent: -24});
  expect(rulerIndentChange("leftIndent", 36, {leftIndent: 12, firstLineIndent: -12}, false))
    .toEqual({leftIndent: 36});
});
it("keeps hanging moves within model bounds without moving the first line", () => {
  const result = rulerIndentChange("hangingIndent", -maximumParagraphIndent, {leftIndent: 1000, firstLineIndent: 1000}, false);
  expect(result.leftIndent + result.firstLineIndent).toBe(2000);
  expect(Math.abs(result.firstLineIndent)).toBeLessThanOrEqual(maximumParagraphIndent);
});
it("accepts explicit physical units without ambiguity", () => {
  expect(parseMeasurement("1in", "mm")).toBe(72);
  expect(parseMeasurement('1"', "pt")).toBe(72);
  expect(parseMeasurement("25.4 mm", "pt")).toBeCloseTo(72);
  expect(parseMeasurement("-2.54cm", "in")).toBeCloseTo(-72);
  expect(parseMeasurement("6pc", "mm")).toBe(72);
  expect(parseMeasurement("NaN", "mm")).toBe(null);
  expect(parseMeasurement("1e8", "mm")).toBe(null);
  expect(parseMeasurement("12px", "mm")).toBe(null);
});
it("keeps major ticks readable through the supported zoom range", () => {
  for (const unit of ["mm","cm","in","pt","pc"] as const)
    for (const scale of [.5, 1, 3])
      expect(rulerTickStep(unit,scale*4/3)*layoutUnits[unit]*scale*4/3).toBeGreaterThanOrEqual(35);
});
