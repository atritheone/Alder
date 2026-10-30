import { describe, it, expect } from "vitest";
import { indexNoteParagraphs, noteBands } from "./richNoteLayout";
import { documentText } from "./textProjection";
import type { DocNode } from "./types";
const paragraph = (text: string): DocNode => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }] : [],
});
describe("rich note layout", () => {
  it("keeps narration offsets through nested lists and parallel/empty cells", () => {
    const body: DocNode = {
      type: "doc",
      content: [
        paragraph("3. "),
        {
          type: "ordered_list",
          content: [
            {
              type: "list_item",
              content: [
                paragraph("One"),
                {
                  type: "bullet_list",
                  content: [
                    { type: "list_item", content: [paragraph("Nested")] },
                  ],
                },
              ],
            },
            { type: "list_item", content: [paragraph("Two")] },
          ],
        },
        {
          type: "table",
          content: [
            {
              type: "table_row",
              content: [
                { type: "table_cell", content: [paragraph("")] },
                {
                  type: "table_cell",
                  content: [paragraph("Emoji \ud83d\ude00")],
                },
              ],
            },
          ],
        },
      ],
    };
    const text = documentText(body).slice(4),
      offsets = indexNoteParagraphs(body, 4),
      values = [...offsets.values()];
    expect(values).toEqual([-4, 0, 4, 11, 15, 16]);
    expect(text.slice(values.at(-1)!)).toBe("Emoji \ud83d\ude00");
  });
  it("never splits an overlapping cell line or image and preserves empty spacing", () => {
    const bands = noteBands(
      [
        { top: 5, bottom: 15 },
        { top: 7, bottom: 20 },
        { top: 21, bottom: 31 },
        { top: 29, bottom: 44 },
        { top: 48, bottom: 58 },
      ],
      65,
    );
    expect(bands).toEqual([
      { top: 0, bottom: 21 },
      { top: 21, bottom: 48 },
      { top: 48, bottom: 65 },
    ]);
    expect(bands.reduce((sum, band) => sum + band.bottom - band.top, 0)).toBe(
      65,
    );
  });
  it('divides oversized blank row space without splitting a glyph or image',()=>{
    expect(noteBands([{top:0,bottom:15}],250,100)).toEqual([{top:0,bottom:100},{top:100,bottom:200},{top:200,bottom:250}]);
    expect(noteBands([{top:0,bottom:120}],250,100)).toEqual([{top:0,bottom:250}]);
  });
});
