import { describe, expect, it } from "vitest";
import { pageAtPosition } from "./pageFlow";

describe("spoken position on physical pages", () => {
  const pages = [
    { from: 0, to: 42, text: "First" },
    { from: 42, to: 87, text: "Second" },
    { from: 87, to: 100, text: "Last" },
  ];
  it("assigns a boundary to the page starting there, including the document end", () => {
    expect(pageAtPosition(pages, 0)).toBe(0);
    expect(pageAtPosition(pages, 41)).toBe(0);
    expect(pageAtPosition(pages, 42)).toBe(1);
    expect(pageAtPosition(pages, 86)).toBe(1);
    expect(pageAtPosition(pages, 87)).toBe(2);
    expect(pageAtPosition(pages, 100)).toBe(2);
    expect(pageAtPosition([], 0)).toBeNull();
  });
});
