import type { EditorState } from "prosemirror-state";
import { closeHistory } from "prosemirror-history";
import { projectText, projectedRange } from "./textProjection";

export type FindOptions = {
  caseSensitive: boolean;
  wholeWord: boolean;
  start?: number;
  end?: number;
};
export type TextMatch = { start: number; end: number; replacement?: string };
export function findText(
  text: string,
  query: string,
  options: FindOptions,
): TextMatch[] {
  if (!query) return [];
  const pattern = new RegExp(
    query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    options.caseSensitive ? "gu" : "giu",
  );
  const matches: TextMatch[] = [];
  const word = (value: string) => /[\p{L}\p{M}\p{N}_]/u.test(value);
  const start = options.start ?? 0,
    end = options.end ?? text.length;
  for (const result of text.matchAll(pattern)) {
    const at = result.index,
      next = at + result[0].length;
    if (at < start || next > end) continue;
    const previous =
      at > 1 && /[\uDC00-\uDFFF]/.test(text[at - 1])
        ? text.slice(at - 2, at)
        : text.slice(Math.max(0, at - 1), at);
    if (
      options.wholeWord &&
      (word(previous) ||
        word(String.fromCodePoint(text.codePointAt(next) || 0)))
    )
      continue;
    matches.push({ start: at, end: next });
  }
  return matches;
}

export function replaceMatches(
  state: EditorState,
  matches: TextMatch[],
  replacement: string,
  expectedText: string,
) {
  const projection = projectText(state.doc);
  if (projection.text !== expectedText)
    throw new Error("The document changed. Search again before replacing.");
  const ordered = [...matches].sort((a, b) => a.start - b.start);
  let previousEnd = 0;
  for (const match of ordered) {
    if (
      !Number.isInteger(match.start) ||
      !Number.isInteger(match.end) ||
      match.start < previousEnd ||
      match.end <= match.start ||
      match.end > expectedText.length
    )
      throw new Error(
        "The search ranges are no longer valid. Search again before replacing.",
      );
    previousEnd = match.end;
  }
  const tr = closeHistory(state.tr);
  for (const match of ordered.reverse()) {
    const range = projectedRange(
      state.doc,
      match.start,
      match.end,
      undefined,
      projection,
    );
    tr.insertText(match.replacement ?? replacement, range.from, range.to);
  }
  return tr;
}
