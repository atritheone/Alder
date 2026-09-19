import type { EditorState, Transaction } from "prosemirror-state";
import { closeHistory } from "prosemirror-history";
import { projectText, projectedRange } from "./textProjection";

export type ProofreadingEdit = {
  start: number;
  end: number;
  originalText: string;
  replacement: string;
};

/** Validate the entire group before making any edit; all changes share one undo step. */
export function proofreadingTransaction(
  state: EditorState,
  expectedText: string,
  edits: ProofreadingEdit[],
): Transaction {
  const projection = projectText(state.doc);
  if (projection.text !== expectedText)
    throw new Error(
      "This suggestion refers to earlier text. Check this passage again.",
    );
  if (!edits.length || edits.length > 20)
    throw new Error("Invalid correction group.");
  const ordered = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  const ranges = ordered.map((edit, index) => {
    if (
      typeof edit.replacement !== "string" ||
      /[\n\r\t]/.test(edit.replacement) ||
      projection.text.slice(edit.start, edit.end) !== edit.originalText ||
      (index > 0 &&
        (edit.start < ordered[index - 1].end ||
          edit.start === ordered[index - 1].start))
    )
      throw new Error(
        "This correction is overlapping or its source has changed.",
      );
    const range = projectedRange(
      state.doc,
      edit.start,
      edit.end,
      expectedText,
      projection,
    );
    if (!state.doc.resolve(range.from).sameParent(state.doc.resolve(range.to)))
      throw new Error(
        "This correction crosses document structure. Edit it manually.",
      );
    let markup: string | undefined;
    state.doc.nodesBetween(range.from, range.to, (node) => {
      if (!node.isText) return;
      const current = JSON.stringify(node.marks.map((mark) => mark.toJSON()));
      if (markup !== undefined && markup !== current)
        throw new Error(
          "This correction crosses formatting or a link. Edit it manually to preserve formatting.",
        );
      markup = current;
    });
    return { ...range, text: edit.replacement };
  });
  const transaction = closeHistory(state.tr);
  for (const range of ranges.reverse())
    transaction.insertText(range.text, range.from, range.to);
  return transaction.setMeta("proofreading", true).scrollIntoView();
}
