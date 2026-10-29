import { it, expect } from "vitest";
import {
  physicalPageAtPosition,
  pagesInRange,
  pageTextSegments,
  contiguousPage,
} from "./pageRanges";
const pages = [
  {
    from: 0,
    to: 25,
    fragments: [
      { from: 0, to: 10 },
      { from: 20, to: 25 },
    ],
  },
  {
    from: 10,
    to: 30,
    fragments: [
      { from: 10, to: 20 },
      { from: 25, to: 30 },
    ],
  },
];
it("follows document reading order through parallel cells that span pages", () => {
  expect(
    [0, 9, 10, 19, 20, 24, 25, 30].map((pos) =>
      physicalPageAtPosition(pages, pos),
    ),
  ).toEqual([0, 0, 1, 1, 0, 0, 1, 1]);
  expect(pagesInRange(pages, 18, 23)).toEqual([0, 1]);
  expect(pagesInRange(pages, 20, 25)).toEqual([0]);
  expect(pagesInRange(pages, 0, 30)).toEqual([0, 1]);
  expect(pagesInRange(pages, 25, 25)).toEqual([1]);
});
it("publishes only each page’s owned text while retaining hidden geometry", () => {
  expect(pageTextSegments(pages[0], 8, 20)).toEqual([
    { from: 0, to: 2, visible: true },
    { from: 2, to: 12, visible: false },
    { from: 12, to: 17, visible: true },
    { from: 17, to: 20, visible: false },
  ]);
  for (let pos = 0; pos < 30; pos++)
    expect(
      pages
        .flatMap((page) => pageTextSegments(page, pos, 1))
        .filter((segment) => segment.visible),
    ).toHaveLength(1);
  expect(contiguousPage(pages[0])).toBe(false);
  expect(contiguousPage({ from: 0, to: 10 })).toBe(true);
});
it("retains ordinary page boundaries, empty parity pages and a fresh index after edits", () => {
  const ordinary = [
    { from: 0, to: 10 },
    { from: 10, to: 10 },
    { from: 10, to: 30 },
  ];
  expect(physicalPageAtPosition(ordinary, 10)).toBe(2);
  expect(physicalPageAtPosition([], 0)).toBeNull();
  expect(pagesInRange(ordinary, 3, 25)).toEqual([0, 1, 2]);
  const changed = [{ from: 0, to: 30, fragments: [{ from: 0, to: 30 }] }];
  expect(physicalPageAtPosition(changed, 20)).toBe(0);
});
