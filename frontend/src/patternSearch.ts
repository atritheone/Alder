import type { FindOptions, TextMatch } from "./findText";

export type PatternSource = { id: string; title: string; text: string };
export type PatternMatch = TextMatch & {
  sourceId: string;
  title: string;
  sourceText: string;
};
export type PatternRequest = {
  sources: PatternSource[];
  query: string;
  replacement: string;
  options: FindOptions;
};
export type PatternHit = TextMatch & { sourceId: string };
export type PatternResult = { matches: PatternHit[]; error?: string };

/** Run only in a disposable worker: unrestricted regular expressions can stall. */
export function searchPatterns(request: PatternRequest): PatternResult {
  try {
    if (!request.query) return { matches: [] };
    const regex = new RegExp(
      request.query,
      request.options.caseSensitive ? "gmu" : "gimu",
    );
    const matches: PatternHit[] = [];
    const word = (value: string) => /[\p{L}\p{M}\p{N}_]/u.test(value);
    let empty = false;
    for (const source of request.sources) {
      for (const result of source.text.matchAll(regex)) {
        const start = result.index,
          end = start + result[0].length;
        if (
          start < (request.options.start ?? 0) ||
          end > (request.options.end ?? source.text.length)
        )
          continue;
        if (start === end) {
          empty = true;
          continue;
        }
        if (
          request.options.wholeWord &&
          (word(
            Array.from(
              source.text.slice(Math.max(0, start - 2), start),
            ).pop() || "",
          ) ||
            word(String.fromCodePoint(source.text.codePointAt(end) || 0)))
        )
          continue;
        const replacement = request.replacement.replace(
          /\$(\$|&|\d{1,2}|<[^>]+>)/g,
          (literal, token: string) => {
            if (token === "$") return "$";
            if (token === "&") return result[0];
            if (token.startsWith("<"))
              return result.groups
                ? (result.groups[token.slice(1, -1)] ?? "")
                : literal;
            const index = Number(token);
            if (index > 0 && index < result.length) return result[index] || "";
            if (
              token.length === 2 &&
              Number(token[0]) > 0 &&
              Number(token[0]) < result.length
            )
              return (result[Number(token[0])] || "") + token[1];
            return literal;
          },
        );
        matches.push({ start, end, replacement, sourceId: source.id });
      }
    }
    if (empty)
      return {
        matches: [],
        error:
          "This pattern also matches empty positions. Use a pattern that matches text before replacing.",
      };
    return { matches };
  } catch (error) {
    return {
      matches: [],
      error: `Invalid pattern: ${(error as Error).message}`,
    };
  }
}
