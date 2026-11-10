import type { EditorState, Transaction } from "prosemirror-state";
import { closeHistory } from "prosemirror-history";
import { projectText, projectedRange } from "./textProjection";
import { formFieldTextEdit } from "./formFields";
import { Fragment, type Mark, type Node as PMNode } from "prosemirror-model";

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
  revision = false,
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
    const textMarks: (readonly Mark[])[] = [];
    const objects: { start: number; end: number; node: PMNode }[] = [];
    state.doc.nodesBetween(range.from, range.to, (node, pos) => {
      if (
        revision &&
        node.isInline &&
        !node.isText &&
        node.textContent &&
        !node.marks.some((mark) => mark.type.name === "revision_deletion")
      ) {
        if (pos < range.from || pos + node.nodeSize > range.to)
          throw new Error(
            "This revision includes only part of a field. Select the complete sentence.",
          );
        const source = projectText(node).text;
        const at = edit.replacement.indexOf(source);
        if (!source || at < 0 || edit.replacement.indexOf(source, at + 1) >= 0)
          throw new Error(
            "This revision cannot retain an inline field unambiguously. Review the proposed wording.",
          );
        objects.push({ start: at, end: at + source.length, node });
        return false;
      }
      if (formFieldTextEdit(node, range.from, range.to, pos)) return;
      if (
        node.type.name === "text_box" &&
        range.from > pos &&
        range.to < pos + node.nodeSize
      )
        return;
      if (
        ["table_of_contents", "bibliography", "citation"].includes(
          node.type.name,
        )
      )
        throw new Error(
          "This text is generated. Edit its source, then update fields.",
        );
      if (node.marks.some((mark) => mark.type.name === "revision_deletion"))
        throw new Error(
          "This correction crosses a tracked deletion. Review that change before correcting the passage.",
        );
      if (node.isInline && !node.isText)
        throw new Error(
          "This correction crosses an inline object. Edit it manually to retain the object.",
        );
      if (!node.isText) return;
      textMarks.push(
        node.marks.filter((mark) => !mark.type.name.startsWith("revision_")),
      );
      const current = JSON.stringify(node.marks.map((mark) => mark.toJSON()));
      if (!revision && markup !== undefined && markup !== current)
        throw new Error(
          "This correction crosses formatting or a link. Edit it manually to preserve formatting.",
        );
      markup = current;
    });
    const formatted: { start: number; end: number; marks: readonly Mark[] }[] =
      [];
    const commonMarks =
      textMarks[0]?.filter((mark) =>
        textMarks.every((marks) => marks.some((other) => other.eq(mark))),
      ) || [];
    if (revision)
      state.doc.nodesBetween(range.from, range.to, (node, pos) => {
        if (node.isInline && !node.isText) return false;
        if (!node.isText) return;
        const extraMarks = node.marks.filter(
          (mark) =>
            !mark.type.name.startsWith("revision_") &&
            !commonMarks.some((common) => common.eq(mark)),
        );
        if (!extraMarks.length) return;
        const source = node.text!.slice(
          Math.max(0, range.from - pos),
          Math.min(node.nodeSize, range.to - pos),
        );
        const at = edit.replacement.indexOf(source);
        if (at < 0 || edit.replacement.indexOf(source, at + 1) >= 0)
          throw new Error(
            "This revision cannot preserve a formatted phrase unambiguously. Adjust the proposed wording before applying it.",
          );
        formatted.push({
          start: at,
          end: at + source.length,
          marks: extraMarks,
        });
      });
    const boundaries = [
      ...new Set([
        0,
        edit.replacement.length,
        ...formatted.flatMap((r) => [r.start, r.end]),
        ...objects.flatMap((r) => [r.start, r.end]),
      ]),
    ].sort((a, b) => a - b);
    const nodes = boundaries.slice(0, -1).flatMap((at, i) => {
      const object = objects.find(
        (r) => r.start <= at && r.end >= boundaries[i + 1],
      );
      if (object) {
        if (at !== object.start || boundaries[i + 1] !== object.end)
          throw new Error(
            "This revision overlaps a protected field. Review the proposed wording.",
          );
        return [object.node];
      }
      const text = edit.replacement.slice(at, boundaries[i + 1]);
      const spans = formatted.filter(
        (r) => r.start <= at && r.end >= boundaries[i + 1],
      );
      if (spans.length > 1)
        throw new Error(
          "This revision has ambiguous formatting. Review its wording before applying it.",
        );
      let marks: readonly Mark[] = commonMarks;
      for (const mark of spans[0]?.marks || []) marks = mark.addToSet(marks);
      return text ? [state.schema.text(text, marks)] : [];
    });
    return {
      ...range,
      text: edit.replacement,
      content: Fragment.fromArray(nodes),
    };
  });
  const transaction = closeHistory(state.tr);
  for (const range of ranges.reverse())
    if (revision) transaction.replaceWith(range.from, range.to, range.content);
    else transaction.insertText(range.text, range.from, range.to);
  return transaction.setMeta("proofreading", true).scrollIntoView();
}
