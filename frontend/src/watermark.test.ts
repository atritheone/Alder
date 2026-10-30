import { describe, it, expect } from "vitest";
import { defaultWatermark, validWatermark } from "./watermark";
import { screenPageGeometry } from "./pageGeometry";
import {
  sectionLayout,
  settingsForLayout,
  validSection,
} from "./sectionLayout";
describe("page watermarks", () => {
  it("retains section removal without changing printable body geometry", () => {
    const plain = screenPageGeometry({ pageSize: "A5" }),
      marked = screenPageGeometry({
        pageSize: "A5",
        watermark: defaultWatermark,
      });
    expect(marked.margins).toEqual(plain.margins);
    expect(
      settingsForLayout({ ...marked, zoom: 1, lineHeight: 1.5 }).watermark,
    ).toEqual(defaultWatermark);
    expect(
      sectionLayout(
        { ...marked, zoom: 1, lineHeight: 1.5 },
        { pageSize: "A5", watermark: null },
      ).watermark,
    ).toBeNull();
    expect(
      validSection({
        kind: "nextPage",
        page: { pageSize: "A5", watermark: defaultWatermark },
      }),
    ).toBe(true);
  });
  it("rejects malformed or non-finite page paint settings", () => {
    expect(validWatermark(null)).toBe(true);
    expect(validWatermark(defaultWatermark)).toBe(true);
    for (const patch of [
      { text: "" },
      { text: "a\nb" },
      { fontFamily: "font;css" },
      { fontFamily: 'font"quote' },
      { fontFamily: "font\\escape" },
      { widthMm: Infinity },
      { heightMm: 0 },
      { angle: 360 },
      { angle: 0.5 },
      { color: "red" },
      { text: "x".repeat(121) },
      { unexpected: 1 },
    ])
      expect(validWatermark({ ...defaultWatermark, ...patch })).toBe(false);
  });
});
