export const pageNumberFormats = {
  decimal: "1, 2, 3…",
  lowerRoman: "i, ii, iii…",
  upperRoman: "I, II, III…",
  lowerLetter: "a, b, c…",
  upperLetter: "A, B, C…",
} as const;
export type PageNumberFormat = keyof typeof pageNumberFormats;
export const validNumberFormat = (value: unknown): value is PageNumberFormat =>
  typeof value === "string" && Object.hasOwn(pageNumberFormats, value);

export function formatPageNumber(
  number: number,
  format: PageNumberFormat = "decimal",
): string {
  if (!Number.isSafeInteger(number) || number < 1) return String(number);
  if (format === "lowerLetter" || format === "upperLetter") {
    // Word page numbering uses A…Z, AA, BB…ZZ, AAA (not spreadsheet columns).
    const text = String.fromCharCode(65 + ((number - 1) % 26)).repeat(
      Math.ceil(number / 26),
    );
    return format === "lowerLetter" ? text.toLowerCase() : text;
  }
  if (format === "lowerRoman" || format === "upperRoman") {
    let text = "";
    for (const [value, symbol] of [
      [1000, "M"],
      [900, "CM"],
      [500, "D"],
      [400, "CD"],
      [100, "C"],
      [90, "XC"],
      [50, "L"],
      [40, "XL"],
      [10, "X"],
      [9, "IX"],
      [5, "V"],
      [4, "IV"],
      [1, "I"],
    ] as const) {
      text += symbol.repeat(Math.floor(number / value));
      number %= value;
    }
    return format === "lowerRoman" ? text.toLowerCase() : text;
  }
  return String(number);
}

/** Explicit restarts advance the label to the requested parity without adding
 * a sheet. Continuing numbering inserts a blank sheet instead, as Word does. */
export function sectionNumbering(
  next: number,
  kind: string,
  restart?: number | null,
) {
  const parity = kind === "oddPage" ? 1 : kind === "evenPage" ? 0 : null;
  const number = restart ?? next;
  const advance = parity !== null && number % 2 !== parity ? 1 : 0;
  return { number: number + advance, blank: restart == null && !!advance };
}
