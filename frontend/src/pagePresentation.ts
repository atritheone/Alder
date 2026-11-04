import type { FlowPage, PageLayout } from "./pageFlow";

// Page maps contain immutable JSON values. Compare those values directly so a
// one-character edit does not allocate two copies of a book's complete text.
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameValue(item, b[index]))
    );
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]),
    )
  );
}

export type PagePresentation = {
  pages: FlowPage[];
  headers: string[];
  layout: PageLayout;
};

export function samePagePresentation(
  a: PagePresentation,
  b: PagePresentation,
): boolean {
  if (
    a.pages.length !== b.pages.length ||
    !sameValue(a.layout, b.layout) ||
    !sameValue(a.headers, b.headers)
  )
    return false;
  return sameSheetPages(a.pages, b.pages);
}

// This is only for the painted sheets. The measured page map, selection,
// navigation and publication must always receive the current full page data.
export function sameSheetPages(a: FlowPage[], b: FlowPage[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((page, index) => {
    const other = b[index];
    return (
      page === other ||
      // The empty parity sheets intentionally have no running furniture.
      ((page.from !== page.to || !!page.noteHTML) ===
        (other.from !== other.to || !!other.noteHTML) &&
        page.noteHTML === other.noteHTML &&
        sameValue(page.frame, other.frame) &&
        sameValue(page.columnRules, other.columnRules) &&
        sameValue(page.lineNumbers, other.lineNumbers))
    );
  });
}
