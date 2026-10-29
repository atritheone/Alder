import { describe, expect, it } from "vitest";
import { formatPageNumber, sectionNumbering } from "./pageNumbering";
import { parseEditorDocument } from "./Editor";

describe("logical page numbering", () => {
  it("formats decimal, Roman and Word's repeated-letter page numbers", () => {
    expect(formatPageNumber(28, "upperLetter")).toBe("BB");
    expect(formatPageNumber(53, "lowerLetter")).toBe("aaa");
    expect(formatPageNumber(49, "lowerRoman")).toBe("xlix");
    expect(formatPageNumber(1999, "upperRoman")).toBe("MCMXCIX");
    expect(formatPageNumber(123)).toBe("123");
  });
  it("inserts parity sheets only when continuing numbering", () => {
    expect(sectionNumbering(2, "oddPage")).toEqual({ number: 3, blank: true });
    expect(sectionNumbering(8, "oddPage", 1)).toEqual({
      number: 1,
      blank: false,
    });
    expect(sectionNumbering(8, "oddPage", 2)).toEqual({
      number: 3,
      blank: false,
    });
    expect(sectionNumbering(7, "evenPage", 1)).toEqual({
      number: 2,
      blank: false,
    });
    expect(sectionNumbering(7, "nextPage", 28)).toEqual({
      number: 28,
      blank: false,
    });
  });
  it.each([0, -1, 1.5, 10000, "2", true, NaN])(
    "rejects invalid section restart %j",
    (numberingStart) => {
      expect(
        parseEditorDocument({
          type: "doc",
          content: [
            {
              type: "section_break",
              attrs: { kind: "nextPage", page: {}, numberingStart },
            },
          ],
        }).document,
      ).toBeNull();
    },
  );
});
