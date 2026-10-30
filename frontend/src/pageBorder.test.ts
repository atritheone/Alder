import { it, expect } from "vitest";
import {
  defaultPageBorder,
  validPageBorder,
  borderVisible,
} from "./pageBorder";
import { screenPageGeometry, pageInsets } from "./pageGeometry";
import {
  sectionLayout,
  validSection,
  settingsForLayout,
} from "./sectionLayout";
it("keeps borders outside body geometry and respects section inheritance/removal", () => {
  const base = {
    ...screenPageGeometry({ pageBorder: defaultPageBorder }),
    lineHeight: 1.6,
    zoom: 1,
  };
  expect(pageInsets(base)).toEqual(pageInsets(screenPageGeometry({})));
  expect(settingsForLayout(base).pageBorder).toEqual(defaultPageBorder);
  expect(
    sectionLayout(base, { pageSize: "A5", pageBorder: null }).pageBorder,
  ).toBeNull();
  expect(sectionLayout(base, { pageSize: "A5" }).pageBorder).toBeUndefined();
  expect(
    validSection({ kind: "nextPage", page: { pageBorder: defaultPageBorder } }),
  ).toBe(true);
  for (const patch of [
    { distance: 32 },
    { width: 0.3 },
    { color: "red" },
    { display: "sometimes" },
  ])
    expect(validPageBorder({ ...defaultPageBorder, ...patch })).toBe(false);
});
it("uses physical first-page-of-section rather than a restarted page label", () => {
  expect(
    borderVisible({ ...defaultPageBorder, display: "firstPage" }, 4, 4),
  ).toBe(true);
  expect(
    borderVisible({ ...defaultPageBorder, display: "notFirstPage" }, 4, 4),
  ).toBe(false);
  expect(
    borderVisible({ ...defaultPageBorder, display: "notFirstPage" }, 5, 4),
  ).toBe(true);
  expect(borderVisible(null, 1)).toBe(false);
});
