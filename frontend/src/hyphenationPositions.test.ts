import { expect, it } from "vitest";
import {
  changedHyphenationPositions,
  hasHyphenationPosition,
} from "./hyphenationPositions";

it("keeps local breaks reusable at changed document positions without false matches between paragraphs", () => {
  const points = new Set([2, 4, 9]);
  const before = [
    { from: 1, points },
    { from: 30, points },
  ];
  const after = [
    { from: 1, points },
    { from: 35, points },
  ];
  expect(
    [0, 1, 3, 5, 10, 15, 29, 30, 32, 39, 40].filter((p) =>
      hasHyphenationPosition(before, p),
    ),
  ).toEqual([3, 5, 10, 32, 39]);
  expect(
    [32, 34, 35, 37, 39, 44, 45].filter((p) =>
      hasHyphenationPosition(after, p),
    ),
  ).toEqual([37, 39, 44]);
  expect(hasHyphenationPosition([], 1)).toBe(false);
});

it("reports only the changed opportunities after dictionary replies and disabled paragraphs", () => {
  const unchanged = new Set([2, 7]);
  expect(
    changedHyphenationPositions(
      [
        { from: 1, points: unchanged },
        { from: 20, points: new Set([2, 4]) },
        { from: 50, points: new Set([3]) },
      ],
      [
        { from: 1, points: unchanged },
        { from: 20, points: new Set([2, 6]) },
      ],
    ),
  ).toEqual({ from: 24, to: 53 });
  expect(
    changedHyphenationPositions(
      [{ from: 1, points: unchanged }],
      [{ from: 1, points: new Set([7, 2]) }],
    ),
  ).toBeNull();
  expect(
    changedHyphenationPositions([], [{ from: 100, points: unchanged }]),
  ).toEqual({ from: 102, to: 107 });
});
