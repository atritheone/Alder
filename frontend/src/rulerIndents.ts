export type RulerIndent =
  | "leftIndent"
  | "rightIndent"
  | "firstLineIndent"
  | "hangingIndent";

export const maximumParagraphIndent = 1440;

export function rulerIndentChange(
  kind: RulerIndent,
  value: number,
  paragraph: Record<string, unknown>,
  rtl: boolean,
): Record<string, number> {
  const leading = rtl ? "rightIndent" : "leftIndent";
  if (kind !== "hangingIndent") return { [kind]: value };
  // A hanging handle moves subsequent lines while keeping the first line fixed.
  const first = Number(paragraph.firstLineIndent || 0);
  const start = Number(paragraph[leading] || 0);
  const bounded = Math.max(-maximumParagraphIndent, Math.min(maximumParagraphIndent, value, start + first + maximumParagraphIndent));
  const actual = Math.max(bounded, start + first - maximumParagraphIndent);
  return { [leading]: actual, firstLineIndent: start + first - actual };
}
