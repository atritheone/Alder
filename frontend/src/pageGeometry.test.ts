import { describe, expect, it } from "vitest";
import cases from "../../backend/tests/fixtures/page-geometry.json";
import { pageGeometry, screenPageGeometry, pageInsets } from "./pageGeometry";

describe("shared page geometry contract", () => {
  for (const fixture of cases)
    it(fixture.name, () => {
      expect(pageGeometry(fixture.settings)).toMatchObject(fixture.expected);
      const screen = screenPageGeometry(fixture.settings);
      expect((screen.width * 25.4) / 96).toBeCloseTo(fixture.expected.width);
      for (const edge of ["top", "right", "bottom", "left"] as const)
        expect((pageInsets(screen)[edge] * 25.4) / 96).toBeCloseTo(
          fixture.expected.margins[edge],
        );
    });
  it("uses legacy pixels only when there are no separate insets", () => {
    expect(pageInsets({ width: 600, height: 800, margin: 42 })).toEqual({
      top: 42,
      right: 42,
      bottom: 42,
      left: 42,
    });
  });
});
