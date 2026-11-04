import { expect, it } from "vitest";
import { formatInteger, parseInteger } from "./numberDisplay";

it("round-trips grouped navigation counts including million-page boundaries", () => {
  for (const value of [0, 1, 999, 1000, 12345, 1000000]) {
    expect(parseInteger(formatInteger(value))).toBe(value);
    expect(parseInteger(String(value))).toBe(value);
  }
  expect(formatInteger(1234567)).toBe("1,234,567");
  expect(parseInteger(" 1,001 ")).toBe(1001);
});

it("rejects incomplete grouping, fractions and unsafe page positions", () => {
  for (const value of ["", "1,00", "1,,000", "12,34,567", "1.5", "1e3", "-1", "9007199254740993"])
    expect(Number.isNaN(parseInteger(value))).toBe(true);
});
