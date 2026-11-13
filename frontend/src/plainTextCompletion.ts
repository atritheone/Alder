import { StateField, type Text } from "@codemirror/state";
import type { CompletionSource } from "@codemirror/autocomplete";

function words(text: string) {
  return text.match(/[\p{L}\p{M}\p{N}_]{2,}/gu) || [];
}
function change(counts: Map<string, number>, text: string, sign: number) {
  for (const word of words(text)) {
    const n = (counts.get(word) || 0) + sign;
    if (n > 0) counts.set(word, n);
    else counts.delete(word);
  }
}
function lineRanges(doc: Text, ranges: { from: number; to: number }[]) {
  const result: { from: number; to: number }[] = [];
  for (const range of ranges) {
    const from = doc.lineAt(range.from).from,
      to = doc.lineAt(range.to).to;
    const previous = result.at(-1);
    if (previous && from <= previous.to + 1)
      previous.to = Math.max(previous.to, to);
    else result.push({ from, to });
  }
  return result;
}
/** Count the whole file once, then update only affected logical lines. */
export const documentWords = StateField.define<Map<string, number>>({
  create(state) {
    const counts = new Map<string, number>();
    change(counts, state.doc.toString(), 1);
    return counts;
  },
  update(value, tr) {
    if (!tr.docChanged) return value;
    const counts = new Map(value),
      before: { from: number; to: number }[] = [],
      after: { from: number; to: number }[] = [];
    tr.changes.iterChangedRanges((a, b, c, d) => {
      before.push({ from: a, to: b });
      after.push({ from: c, to: d });
    });
    for (const r of lineRanges(tr.startState.doc, before))
      change(counts, tr.startState.doc.sliceString(r.from, r.to), -1);
    for (const r of lineRanges(tr.newDoc, after))
      change(counts, tr.newDoc.sliceString(r.from, r.to), 1);
    return counts;
  },
});
export const completeDocumentWord: CompletionSource = (context) => {
  if (context.view?.composing) return null;
  const token = context.matchBefore(/[\p{L}\p{M}\p{N}_]+/u);
  if (!token) return null;
  const prefix = token.text.toLocaleLowerCase();
  const options = [...context.state.field(documentWords)]
    .filter(
      ([word]) =>
        word.toLocaleLowerCase().startsWith(prefix) && word !== token.text,
    )
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 100)
    .map(([label, count]) => ({
      label,
      boost: Math.min(50, count),
      type: "text",
    }));
  return { from: token.from, options, validFor: /^[\p{L}\p{M}\p{N}_]*$/u };
};
