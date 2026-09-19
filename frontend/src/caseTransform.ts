import { Plugin, type EditorState, type Transaction } from "prosemirror-state";
import { closeHistory, isHistoryTransaction } from "prosemirror-history";
export type LetterCase = "upper" | "lower" | "sentence" | "title";
export type CaseMode = "free" | LetterCase;

/** Replace text nodes individually so marks, links, images and block layout survive. */
export function changeCase(
  state: EditorState,
  kind: LetterCase,
  wholeDocument = false,
): Transaction {
  const from = wholeDocument ? 0 : state.selection.from;
  const to = wholeDocument ? state.doc.content.size : state.selection.to;
  const parts: {
    from: number;
    to: number;
    text: string;
    offset: number;
    node: typeof state.doc;
  }[] = [];
  let text = "",
    block = -1;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) {
      if (block !== -1) text += "\n";
      block = pos;
    }
    if (!node.isText) return;
    const start = Math.max(from, pos),
      end = Math.min(to, pos + node.nodeSize);
    const value = node.text!.slice(start - pos, end - pos);
    parts.push({
      from: start,
      to: end,
      text: value,
      offset: text.length,
      node,
    });
    text += value;
  });
  const capitals = capitalPositions(text, kind);
  const tr = closeHistory(state.tr).setMeta("caseCommand", true);
  for (const part of parts.reverse()) {
    let next = "",
      offset = part.offset;
    for (const character of part.text) {
      next +=
        kind === "upper" || capitals.has(offset)
          ? character.toUpperCase()
          : character.toLowerCase();
      offset += character.length;
    }
    if (next !== part.text)
      tr.replaceWith(
        part.from,
        part.to,
        state.schema.text(next, part.node.marks),
      );
  }
  return tr;
}

function capitalPositions(text: string, kind: LetterCase) {
  const capitals = new Set<number>();
  if (kind === "title") {
    for (const match of text.matchAll(/\p{L}[\p{L}\p{N}'’]*/gu))
      capitals.add(match.index!);
  } else if (kind === "sentence") {
    for (const match of text.matchAll(
      /(?:^|[.!?]\s+|\n)\s*["'“‘(\[]*(\p{L})/gu,
    ))
      capitals.add(match.index! + match[0].length - match[1].length);
    for (const match of text.matchAll(/\bI\b/gi)) capitals.add(match.index!);
  }
  return capitals;
}

/** Normalize new input only, leaving unselected authored text and undo intact. */
export function caseInputPlugin(
  mode: () => CaseMode,
  composing: () => boolean = () => false,
) {
  let compositionStart: EditorState["doc"] | null = null;
  return new Plugin({
    appendTransaction(transactions, oldState, state) {
      const kind = mode();
      if (
        kind === "free" ||
        transactions.some(
          (tr) => isHistoryTransaction(tr) || tr.getMeta("caseCommand"),
        )
      ) {
        compositionStart = null;
        return null;
      }
      if (composing()) {
        if (transactions.some((tr) => tr.docChanged))
          compositionStart ||= oldState.doc;
        return null;
      }
      const before = compositionStart || oldState.doc;
      compositionStart = null;
      let from = before.content.findDiffStart(state.doc.content);
      const end = before.content.findDiffEnd(state.doc.content);
      if (from == null || !end) return null;
      const to = end.b + Math.max(0, from - Math.min(end.a, end.b));
      if (to <= from) return null;
      // An initially standalone "i" may grow into "inside" on the next key.
      // Revisit that one autocapitalized letter when it becomes part of a word.
      if (kind === "sentence") {
        const cursor = state.doc.resolve(from);
        const prefix = cursor.parent.textBetween(
          0,
          cursor.parentOffset,
          "",
          "\ufffc",
        );
        if (
          /(?:^|[^\p{L}\p{N}])I$/u.test(prefix) &&
          /^\p{L}/u.test(state.doc.textBetween(from, to, "", "\ufffc"))
        )
          from--;
      }
      const parts: {
        from: number;
        to: number;
        text: string;
        marks: typeof state.doc.marks;
      }[] = [];
      const contexts = new Map<number, Set<number>>();
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isText) return;
        const start = Math.max(from, pos),
          finish = Math.min(to, pos + node.nodeSize);
        const resolved = state.doc.resolve(pos);
        const blockStart = resolved.start();
        let capitals = contexts.get(blockStart);
        if (!capitals) {
          const text = resolved.parent.textBetween(
            0,
            resolved.parent.content.size,
            "",
            (node) => (node.type.name === "hard_break" ? "\n" : "\ufffc"),
          );
          capitals = capitalPositions(text, kind);
          contexts.set(blockStart, capitals);
        }
        const original = node.text!.slice(start - pos, finish - pos);
        let text = "",
          offset = start - blockStart;
        for (const character of original) {
          text +=
            kind === "upper" || capitals.has(offset)
              ? character.toUpperCase()
              : character.toLowerCase();
          offset += character.length;
        }
        if (text !== original)
          parts.push({ from: start, to: finish, text, marks: node.marks });
      });
      if (!parts.length) return null;
      const tr = state.tr.setMeta("caseInput", true);
      for (const part of parts.reverse())
        tr.replaceWith(
          part.from,
          part.to,
          state.schema.text(part.text, part.marks),
        );
      return tr;
    },
  });
}
