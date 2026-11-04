import type { EditorState, Selection } from "prosemirror-state";
import type { Mark } from "prosemirror-model";
import { closeHistory } from "prosemirror-history";

export type SymbolEntry = { value: string; name: string; group: string };
export const symbolCatalogue: SymbolEntry[] = [
  { value: "\u00a0", name: "Nonbreaking space", group: "Punctuation" },
  { value: "\u202f", name: "Narrow nonbreaking space", group: "Punctuation" },
  { value: "\u2009", name: "Thin space", group: "Punctuation" },
  { value: "\u00ad", name: "Soft hyphen", group: "Punctuation" },
  { value: "\u2010", name: "Hyphen", group: "Punctuation" },
  { value: "\u2011", name: "Non-breaking hyphen", group: "Punctuation" },
  { value: "\u2013", name: "En dash", group: "Punctuation" },
  { value: "\u2014", name: "Em dash", group: "Punctuation" },
  { value: "\u2018", name: "Left single quotation mark", group: "Punctuation" },
  {
    value: "\u2019",
    name: "Right single quotation mark",
    group: "Punctuation",
  },
  { value: "\u201c", name: "Left double quotation mark", group: "Punctuation" },
  {
    value: "\u201d",
    name: "Right double quotation mark",
    group: "Punctuation",
  },
  {
    value: "\u00ab",
    name: "Left-pointing double angle quotation mark",
    group: "Punctuation",
  },
  {
    value: "\u00bb",
    name: "Right-pointing double angle quotation mark",
    group: "Punctuation",
  },
  {
    value: "\u2039",
    name: "Single left-pointing angle quotation mark",
    group: "Punctuation",
  },
  {
    value: "\u203a",
    name: "Single right-pointing angle quotation mark",
    group: "Punctuation",
  },
  { value: "\u2026", name: "Horizontal ellipsis", group: "Punctuation" },
  { value: "\u2022", name: "Bullet", group: "Punctuation" },
  { value: "\u00b7", name: "Middle dot", group: "Punctuation" },
  { value: "\u00a7", name: "Section sign", group: "Punctuation" },
  { value: "\u00b6", name: "Pilcrow sign", group: "Punctuation" },
  { value: "\u2020", name: "Dagger", group: "Punctuation" },
  { value: "\u2021", name: "Double dagger", group: "Punctuation" },
  { value: "\u00a9", name: "Copyright sign", group: "Punctuation" },
  { value: "\u00ae", name: "Registered sign", group: "Punctuation" },
  { value: "\u2122", name: "Trade mark sign", group: "Punctuation" },
  { value: "\u00b0", name: "Degree sign", group: "Punctuation" },
  { value: "\u2032", name: "Prime", group: "Punctuation" },
  { value: "\u2033", name: "Double prime", group: "Punctuation" },
  { value: "$", name: "Dollar sign", group: "Currency" },
  { value: "\u00a2", name: "Cent sign", group: "Currency" },
  { value: "\u00a3", name: "Pound sign", group: "Currency" },
  { value: "\u00a5", name: "Yen sign", group: "Currency" },
  { value: "\u20ac", name: "Euro sign", group: "Currency" },
  { value: "\u20b9", name: "Indian rupee sign", group: "Currency" },
  { value: "\u20a9", name: "Won sign", group: "Currency" },
  { value: "\u20bd", name: "Ruble sign", group: "Currency" },
  { value: "\u0e3f", name: "Thai currency symbol baht", group: "Currency" },
  { value: "\u20ab", name: "Dong sign", group: "Currency" },
  { value: "\u20b4", name: "Hryvnia sign", group: "Currency" },
  { value: "\u00b1", name: "Plus-minus sign", group: "Mathematics" },
  { value: "\u2212", name: "Minus sign", group: "Mathematics" },
  { value: "\u00d7", name: "Multiplication sign", group: "Mathematics" },
  { value: "\u00f7", name: "Division sign", group: "Mathematics" },
  { value: "\u2260", name: "Not equal to", group: "Mathematics" },
  { value: "\u2248", name: "Almost equal to", group: "Mathematics" },
  { value: "\u2261", name: "Identical to", group: "Mathematics" },
  { value: "\u2264", name: "Less-than or equal to", group: "Mathematics" },
  { value: "\u2265", name: "Greater-than or equal to", group: "Mathematics" },
  { value: "\u221e", name: "Infinity", group: "Mathematics" },
  { value: "\u221a", name: "Square root", group: "Mathematics" },
  { value: "\u221b", name: "Cube root", group: "Mathematics" },
  { value: "\u2211", name: "N-ary summation", group: "Mathematics" },
  { value: "\u220f", name: "N-ary product", group: "Mathematics" },
  { value: "\u222b", name: "Integral", group: "Mathematics" },
  { value: "\u2202", name: "Partial differential", group: "Mathematics" },
  { value: "\u2207", name: "Nabla", group: "Mathematics" },
  { value: "\u2206", name: "Increment", group: "Mathematics" },
  { value: "\u2208", name: "Element of", group: "Mathematics" },
  { value: "\u2209", name: "Not an element of", group: "Mathematics" },
  { value: "\u2205", name: "Empty set", group: "Mathematics" },
  { value: "\u222a", name: "Union", group: "Mathematics" },
  { value: "\u2229", name: "Intersection", group: "Mathematics" },
  { value: "\u2282", name: "Subset of", group: "Mathematics" },
  { value: "\u2283", name: "Superset of", group: "Mathematics" },
  { value: "\u2286", name: "Subset of or equal to", group: "Mathematics" },
  { value: "\u2287", name: "Superset of or equal to", group: "Mathematics" },
  { value: "\u2200", name: "For all", group: "Mathematics" },
  { value: "\u2203", name: "There exists", group: "Mathematics" },
  { value: "\u2234", name: "Therefore", group: "Mathematics" },
  { value: "\u2235", name: "Because", group: "Mathematics" },
  { value: "\u2220", name: "Angle", group: "Mathematics" },
  { value: "\u22a5", name: "Up tack", group: "Mathematics" },
  { value: "\u2225", name: "Parallel to", group: "Mathematics" },
  { value: "\u0391", name: "Greek capital letter alpha", group: "Greek" },
  { value: "\u0392", name: "Greek capital letter beta", group: "Greek" },
  { value: "\u0393", name: "Greek capital letter gamma", group: "Greek" },
  { value: "\u0394", name: "Greek capital letter delta", group: "Greek" },
  { value: "\u0395", name: "Greek capital letter epsilon", group: "Greek" },
  { value: "\u0396", name: "Greek capital letter zeta", group: "Greek" },
  { value: "\u0397", name: "Greek capital letter eta", group: "Greek" },
  { value: "\u0398", name: "Greek capital letter theta", group: "Greek" },
  { value: "\u0399", name: "Greek capital letter iota", group: "Greek" },
  { value: "\u039a", name: "Greek capital letter kappa", group: "Greek" },
  { value: "\u039b", name: "Greek capital letter lamda", group: "Greek" },
  { value: "\u039c", name: "Greek capital letter mu", group: "Greek" },
  { value: "\u039d", name: "Greek capital letter nu", group: "Greek" },
  { value: "\u039e", name: "Greek capital letter xi", group: "Greek" },
  { value: "\u039f", name: "Greek capital letter omicron", group: "Greek" },
  { value: "\u03a0", name: "Greek capital letter pi", group: "Greek" },
  { value: "\u03a1", name: "Greek capital letter rho", group: "Greek" },
  { value: "\u03a3", name: "Greek capital letter sigma", group: "Greek" },
  { value: "\u03a4", name: "Greek capital letter tau", group: "Greek" },
  { value: "\u03a5", name: "Greek capital letter upsilon", group: "Greek" },
  { value: "\u03a6", name: "Greek capital letter phi", group: "Greek" },
  { value: "\u03a7", name: "Greek capital letter chi", group: "Greek" },
  { value: "\u03a8", name: "Greek capital letter psi", group: "Greek" },
  { value: "\u03a9", name: "Greek capital letter omega", group: "Greek" },
  {
    value: "\u03aa",
    name: "Greek capital letter iota with dialytika",
    group: "Greek",
  },
  {
    value: "\u03ab",
    name: "Greek capital letter upsilon with dialytika",
    group: "Greek",
  },
  {
    value: "\u03ac",
    name: "Greek small letter alpha with tonos",
    group: "Greek",
  },
  {
    value: "\u03ad",
    name: "Greek small letter epsilon with tonos",
    group: "Greek",
  },
  {
    value: "\u03ae",
    name: "Greek small letter eta with tonos",
    group: "Greek",
  },
  {
    value: "\u03af",
    name: "Greek small letter iota with tonos",
    group: "Greek",
  },
  {
    value: "\u03b0",
    name: "Greek small letter upsilon with dialytika and tonos",
    group: "Greek",
  },
  { value: "\u03b1", name: "Greek small letter alpha", group: "Greek" },
  { value: "\u03b2", name: "Greek small letter beta", group: "Greek" },
  { value: "\u03b3", name: "Greek small letter gamma", group: "Greek" },
  { value: "\u03b4", name: "Greek small letter delta", group: "Greek" },
  { value: "\u03b5", name: "Greek small letter epsilon", group: "Greek" },
  { value: "\u03b6", name: "Greek small letter zeta", group: "Greek" },
  { value: "\u03b7", name: "Greek small letter eta", group: "Greek" },
  { value: "\u03b8", name: "Greek small letter theta", group: "Greek" },
  { value: "\u03b9", name: "Greek small letter iota", group: "Greek" },
  { value: "\u03ba", name: "Greek small letter kappa", group: "Greek" },
  { value: "\u03bb", name: "Greek small letter lamda", group: "Greek" },
  { value: "\u03bc", name: "Greek small letter mu", group: "Greek" },
  { value: "\u03bd", name: "Greek small letter nu", group: "Greek" },
  { value: "\u03be", name: "Greek small letter xi", group: "Greek" },
  { value: "\u03bf", name: "Greek small letter omicron", group: "Greek" },
  { value: "\u03c0", name: "Greek small letter pi", group: "Greek" },
  { value: "\u03c1", name: "Greek small letter rho", group: "Greek" },
  { value: "\u03c2", name: "Greek small letter final sigma", group: "Greek" },
  { value: "\u03c3", name: "Greek small letter sigma", group: "Greek" },
  { value: "\u03c4", name: "Greek small letter tau", group: "Greek" },
  { value: "\u03c5", name: "Greek small letter upsilon", group: "Greek" },
  { value: "\u03c6", name: "Greek small letter phi", group: "Greek" },
  { value: "\u03c7", name: "Greek small letter chi", group: "Greek" },
  { value: "\u03c8", name: "Greek small letter psi", group: "Greek" },
  { value: "\u03c9", name: "Greek small letter omega", group: "Greek" },
  { value: "\u2190", name: "Leftwards arrow", group: "Arrows" },
  { value: "\u2191", name: "Upwards arrow", group: "Arrows" },
  { value: "\u2192", name: "Rightwards arrow", group: "Arrows" },
  { value: "\u2193", name: "Downwards arrow", group: "Arrows" },
  { value: "\u2194", name: "Left right arrow", group: "Arrows" },
  { value: "\u2195", name: "Up down arrow", group: "Arrows" },
  { value: "\u21d0", name: "Leftwards double arrow", group: "Arrows" },
  { value: "\u21d2", name: "Rightwards double arrow", group: "Arrows" },
  { value: "\u21d4", name: "Left right double arrow", group: "Arrows" },
  { value: "\u21a6", name: "Rightwards arrow from bar", group: "Arrows" },
  { value: "\u00b5", name: "Micro sign", group: "Mathematics" },
  {
    value: "\u00bc",
    name: "Vulgar fraction one quarter",
    group: "Mathematics",
  },
  { value: "\u00bd", name: "Vulgar fraction one half", group: "Mathematics" },
  {
    value: "\u00be",
    name: "Vulgar fraction three quarters",
    group: "Mathematics",
  },
  { value: "\u00b9", name: "Superscript one", group: "Mathematics" },
  { value: "\u00b2", name: "Superscript two", group: "Mathematics" },
  { value: "\u00b3", name: "Superscript three", group: "Mathematics" },
];
export const symbolCode = (value: string) =>
  `U+${value.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;

/** Insert scalar values, never malformed surrogates, controls or noncharacters. */
export function symbolFromCode(code: string): string | null {
  const match = /^(?:U\+)?([0-9a-f]{1,6})$/i.exec(code.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  if (
    value < 0x20 ||
    value > 0x10ffff ||
    (value >= 0x7f && value <= 0x9f) ||
    (value >= 0xd800 && value <= 0xdfff) ||
    (value >= 0xfdd0 && value <= 0xfdef) ||
    (value & 0xffff) >= 0xfffe
  )
    return null;
  return String.fromCodePoint(value);
}
export function findSymbols(query: string, group = "") {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return symbolCatalogue.filter(
    (item) =>
      (!group || item.group === group) &&
      terms.every((term) =>
        `${item.name} ${item.value} ${symbolCode(item.value)}`
          .toLowerCase()
          .includes(term),
      ),
  );
}
export function insertSymbol(
  state: EditorState,
  value: string,
  selection: Selection = state.selection,
  marks: readonly Mark[] | null = state.storedMarks,
) {
  if ([...value].length !== 1 || symbolFromCode(symbolCode(value)) !== value)
    throw new Error("Choose a valid Unicode character.");
  return closeHistory(state.tr)
    .setSelection(selection)
    .setStoredMarks(marks)
    .insertText(value)
    .scrollIntoView();
}
