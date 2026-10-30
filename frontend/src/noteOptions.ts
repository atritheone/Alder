import { validNumberFormat, type PageNumberFormat } from "./pageNumbering";
export type NoteNumbering = {
  format: PageNumberFormat;
  start: number;
  restart: "continuous" | "section" | "page";
};
export type NoteOptions = {
  footnote: NoteNumbering & { placement: "pageBottom" | "beneathText" };
  endnote: NoteNumbering;
};
export type NoteCounts = { footnote: number; endnote: number };
export type NoteContext = NoteCounts & {
  totals?: NoteCounts;
  options?: NoteOptions;
};
/** Word's continuous numbering counts every preceding reference, including
 * references in sections which restarted. Starts belong to the active section. */
export function noteCounter(settings?: NoteOptions, context?: NoteContext) {
  let options = noteOptions(context?.options || settings),
    section = 0;
  const counts = {
      footnote: context?.footnote || 0,
      endnote: context?.endnote || 0,
    },
    totals = { ...(context?.totals || counts) },
    pageCounts = new Map<number, number>();
  return {
    section(value?: NoteOptions | null) {
      if (value) options = noteOptions(value);
      counts.footnote = counts.endnote = 0;
      section++;
    },
    next(kind: keyof NoteCounts, page?: number) {
      counts[kind]++;
      totals[kind]++;
      if (kind === "footnote" && page != null)
        pageCounts.set(page, (pageCounts.get(page) || 0) + 1);
      const row = options[kind],
        count =
          row.restart === "section"
            ? counts[kind]
            : row.restart === "page" && page != null
              ? pageCounts.get(page)!
              : totals[kind];
      return {
        value: count + row.start - 1,
        format: row.format,
        options,
        section,
        layoutDependent: kind === "footnote" && row.restart === "page",
      };
    },
    snapshot(): NoteContext {
      return { ...counts, totals: { ...totals }, options };
    },
  };
}
export function noteOptions(value?: Partial<NoteOptions>): NoteOptions {
  return {
    footnote: {
      format: "decimal",
      start: 1,
      restart: "continuous",
      placement: "pageBottom",
      ...value?.footnote,
    },
    endnote: {
      format: "lowerRoman",
      start: 1,
      restart: "continuous",
      ...value?.endnote,
    },
  };
}
export function validNoteOptions(value: unknown): value is NoteOptions {
  if (value == null) return true;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  for (const [kind, row] of Object.entries(value)) {
    if (
      !["footnote", "endnote"].includes(kind) ||
      !row ||
      typeof row !== "object" ||
      Array.isArray(row)
    )
      return false;
    if (
      Object.keys(row).some(
        (key) =>
          ![
            "format",
            "start",
            "restart",
            ...(kind === "footnote" ? ["placement"] : []),
          ].includes(key),
      )
    )
      return false;
  }
  const options = noteOptions(value as Partial<NoteOptions>);
  return (
    Object.keys(value).every(
      (key) => key === "footnote" || key === "endnote",
    ) &&
    ["footnote", "endnote"].every((kind) => {
      const row = options[kind as keyof NoteOptions];
      return (
        validNumberFormat(row.format) &&
        Number.isInteger(row.start) &&
        row.start >= 1 &&
        row.start <= 32767 &&
        (kind === "footnote"
          ? ["continuous", "section", "page"]
          : ["continuous", "section"]
        ).includes(row.restart)
      );
    }) &&
    ["pageBottom", "beneathText"].includes(options.footnote.placement)
  );
}
