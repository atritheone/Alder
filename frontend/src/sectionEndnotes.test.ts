import { it, expect } from "vitest";
import { flowEndnoteBank } from "./sectionEndnotes";
import { noteOptions, validNoteOptions } from "./noteOptions";
import { screenPageGeometry } from "./pageGeometry";
import type { PageLayout } from "./pageFlow";

const layout = {
  ...screenPageGeometry({
    pageSize: "Custom",
    pageWidthMm: 100,
    pageHeightMm: 100,
    marginMm: 0,
  }),
  lineHeight: 1.2,
  zoom: 1,
} as PageLayout;
it("flows section notes after body, across reservations, without duplicating any wording", () => {
  let page = 0;
  const lines = Array.from({ length: 12 }, (_, i) => ({
    height: 30,
    html: `WORD_${i}_END`,
  }));
  const placed = flowEndnoteBank(
    { pos: 20, notes: [{ id: 'a"<&', lines }] },
    300,
    () => ({ page, layout, reserve: page === 0 ? 40 : 0 }),
    () => {
      page++;
    },
  );
  expect([...placed.html.keys()]).toEqual([1]);
  const html = [...placed.html.values()].join("");
  for (let i = 0; i < 12; i++)
    expect(html.split(`WORD_${i}_END`)).toHaveLength(2);
  expect(html).toContain("a&quot;&lt;&amp;");
  expect(placed.used).toBe(374);
});
it("keeps row headings with their first line and repeats them on a continuation", () => {
  let page = 0;
  const placed = flowEndnoteBank(
    {
      pos: 10,
      notes: [
        {
          id: "a",
          lines: [
            { height: 20, html: "heading", keepWithNext: true },
            { height: 180, html: "first" },
            {
              height: 180,
              html: "second",
              repeat: [{ height: 20, html: "heading" }],
            },
          ],
        },
      ],
    },
    200,
    () => ({ page, layout, reserve: 0 }),
    () => {
      page++;
    },
  );
  expect([...placed.html.keys()]).toEqual([1, 2]);
  expect(placed.html.get(1)).toContain("first");
  expect(placed.html.get(2)).toContain("heading");
  expect(placed.html.get(2)).toContain("second");
});
it("refuses unplaceable note content and validates placement with compatible defaults", () => {
  expect(() =>
    flowEndnoteBank(
      {
        pos: 1,
        notes: [{ id: "a", lines: [{ height: 1000, html: "too tall" }] }],
      },
      0,
      () => ({ page: 0, layout, reserve: 0 }),
      () => {},
    ),
  ).toThrow("taller");
  const options = noteOptions();
  expect(options.endnote.placement).toBe("docEnd");
  options.endnote.placement = "sectEnd";
  expect(validNoteOptions(options)).toBe(true);
  expect(validNoteOptions({ endnote: { placement: "pageBottom" } })).toBe(
    false,
  );
  expect(validNoteOptions({ endnote: { restart: "section" } })).toBe(true);
});
