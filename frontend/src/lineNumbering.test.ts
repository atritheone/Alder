import { expect, it } from "vitest";
import { defaultLineNumbering, validLineNumbering } from "./lineNumbering";
import { screenPageGeometry } from "./pageGeometry";
import {
  sectionLayout,
  settingsForLayout,
  validSection,
} from "./sectionLayout";
it("preserves independent section numbering and explicit removal without changing margins", () => {
  const geometry = screenPageGeometry({
    pageSize: "A5",
    lineNumbering: defaultLineNumbering,
  });
  const layout = { ...geometry, lineHeight: 1.5, zoom: 1 };
  expect(geometry.margins).toEqual(
    screenPageGeometry({ pageSize: "A5" }).margins,
  );
  expect(settingsForLayout(layout).lineNumbering).toEqual(defaultLineNumbering);
  expect(
    sectionLayout(layout, { pageSize: "A5", lineNumbering: null })
      .lineNumbering,
  ).toBeNull();
  expect(
    validSection({
      kind: "continuous",
      page: {
        pageSize: "A5",
        lineNumbering: {
          ...defaultLineNumbering,
          start: 12,
          restart: "newSection",
        },
      },
    }),
  ).toBe(true);
});
it("rejects malformed intervals, starts and distances before page layout", () => {
  expect(validLineNumbering(null)).toBe(true);
  for (const patch of [
    { start: 0 },
    { start: 1.5 },
    { start: true },
    { step: 0 },
    { step: 1001 },
    { distance: Infinity },
    { distance: -1 },
    { restart: "unknown" },
    { extra: 1 },
  ])
    expect(validLineNumbering({ ...defaultLineNumbering, ...patch })).toBe(
      false,
    );
});
