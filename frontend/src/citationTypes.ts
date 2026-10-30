/** Portable CSL-JSON sources are embedded in citations as independent snapshots.
 * Library changes never silently rewrite a document or its undo history. */
export type CitationSource = {
  id: string;
  type: string;
  title?: string;
  [key: string]: any;
};
export type CitationItem = {
  source: CitationSource;
  locator?: string;
  label?: string;
  prefix?: string;
  suffix?: string;
  suppressAuthor?: boolean;
};
export const citationStyles = {
  apa: "APA 7 · author–date",
  ieee: "IEEE · numeric",
};
export type CitationStyle = keyof typeof citationStyles;
export const locatorLabels = [
  "page",
  "chapter",
  "section",
  "paragraph",
  "volume",
  "issue",
  "figure",
  "table",
] as const;
const unsafeKeys = new Set(["__proto__", "constructor", "prototype"]);
const sourceTypes = new Set([
  "article",
  "article-journal",
  "article-magazine",
  "article-newspaper",
  "bill",
  "book",
  "broadcast",
  "chapter",
  "classic",
  "collection",
  "dataset",
  "document",
  "entry",
  "entry-dictionary",
  "entry-encyclopedia",
  "event",
  "figure",
  "graphic",
  "hearing",
  "interview",
  "legal_case",
  "legislation",
  "manuscript",
  "map",
  "motion_picture",
  "musical_score",
  "pamphlet",
  "paper-conference",
  "patent",
  "performance",
  "periodical",
  "personal_communication",
  "post",
  "post-weblog",
  "regulation",
  "report",
  "review",
  "review-book",
  "software",
  "song",
  "speech",
  "standard",
  "thesis",
  "treaty",
  "webpage",
]);
export function validCitationSource(source: any): source is CitationSource {
  let count = 0;
  const walk = (value: any, depth: number): boolean => {
    if (++count > 4000 || depth > 8) return false;
    if (value == null || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value === "string")
      return (
        value.length <= 10000 &&
        !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
      );
    if (Array.isArray(value))
      return value.length <= 500 && value.every((v) => walk(v, depth + 1));
    return (
      typeof value === "object" &&
      Object.entries(value).every(
        ([key, v]) =>
          !unsafeKeys.has(key) && key.length <= 100 && walk(v, depth + 1),
      )
    );
  };
  const names = [
    "author",
    "editor",
    "translator",
    "collection-editor",
    "compiler",
    "original-author",
    "interviewer",
    "recipient",
    "container-author",
    "director",
    "illustrator",
    "composer",
    "editorial-director",
    "reviewed-author",
  ];
  const dates = [
    "issued",
    "accessed",
    "available-date",
    "event-date",
    "original-date",
    "submitted",
  ];
  return (
    !!source &&
    !Array.isArray(source) &&
    typeof source.id === "string" &&
    source.id.length > 0 &&
    source.id.length <= 128 &&
    sourceTypes.has(source.type) &&
    walk(source, 0) &&
    JSON.stringify(source).length <= 64000 &&
    [
      "title",
      "container-title",
      "publisher",
      "publisher-place",
      "URL",
      "DOI",
      "ISBN",
      "ISSN",
      "language",
    ].every((key) => source[key] == null || typeof source[key] === "string") &&
    names.every(
      (key) =>
        source[key] == null ||
        (Array.isArray(source[key]) &&
          source[key].every(
            (name: any) =>
              name &&
              typeof name === "object" &&
              !Array.isArray(name) &&
              Object.entries(name).every(([key, value]) =>
                ["comma-suffix", "static-ordering", "parse-names"].includes(key)
                  ? typeof value === "boolean"
                  : typeof value === "string",
              ),
          )),
    ) &&
    dates.every(
      (key) =>
        source[key] == null ||
        (source[key] &&
          typeof source[key] === "object" &&
          !Array.isArray(source[key]) &&
          (source[key]["date-parts"] == null ||
            (Array.isArray(source[key]["date-parts"]) &&
              source[key]["date-parts"].length <= 2 &&
              source[key]["date-parts"].every(
                (part: any) =>
                  Array.isArray(part) &&
                  part.length >= 1 &&
                  part.length <= 3 &&
                  part.every(
                    (number: any) =>
                      Number.isInteger(number) && Math.abs(number) <= 9999,
                  ),
              )))),
    )
  );
}
export function validCitationItems(items: any): items is CitationItem[] {
  return (
    Array.isArray(items) &&
    items.length > 0 &&
    items.length <= 100 &&
    items.every(
      (item) =>
        item &&
        validCitationSource(item.source) &&
        Object.keys(item).every((key) =>
          [
            "source",
            "locator",
            "label",
            "prefix",
            "suffix",
            "suppressAuthor",
          ].includes(key),
        ) &&
        ["locator", "prefix", "suffix"].every(
          (key) =>
            item[key] == null ||
            (typeof item[key] === "string" && item[key].length <= 1000),
        ) &&
        (item.label == null || locatorLabels.includes(item.label)) &&
        (item.suppressAuthor == null ||
          typeof item.suppressAuthor === "boolean"),
    )
  );
}
export function stableCitationJSON(value: any): string {
  return JSON.stringify(value, (_key, child) =>
    child && typeof child === "object" && !Array.isArray(child)
      ? Object.fromEntries(
          Object.keys(child)
            .sort()
            .map((key) => [key, child[key]]),
        )
      : child,
  );
}
export const sourceLabel = (source: CitationSource) =>
  source.title || source.id;
