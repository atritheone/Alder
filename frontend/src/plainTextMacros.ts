import {
  EditorSelection,
  EditorState,
  type ChangeSet,
  type Transaction,
} from "@codemirror/state";

export type MacroStep = {
  changes: { from: number; to: number; insert: string }[];
  ranges: { anchor: number; head: number }[];
  main: number;
};
export type TextMacro = { name: string; steps: MacroStep[] };
/** Store edits and selections relative to the caret, never mouse coordinates. */
export function recordMacroStep(tr: Transaction): MacroStep | null {
  if (!tr.docChanged && !tr.selection) return null;
  const base = tr.startState.selection.main.head,
    changes: MacroStep["changes"] = [];
  tr.changes.iterChanges((from, to, _newFrom, _newTo, insert) =>
    changes.push({
      from: from - base,
      to: to - base,
      insert: insert.toString(),
    }),
  );
  return {
    changes,
    ranges: tr.newSelection.ranges.map((r) => ({
      anchor: r.anchor - base,
      head: r.head - base,
    })),
    main: tr.newSelection.mainIndex,
  };
}
export async function prepareMacro(
  initial: EditorState,
  steps: readonly MacroStep[],
  repeat: number,
  signal?: AbortSignal,
) {
  if (
    !Number.isInteger(repeat) ||
    repeat < 1 ||
    repeat > 1000 ||
    !steps.length ||
    steps.length * repeat > 10000
  )
    throw new Error(
      "Use 1–1000 repetitions and at most 10,000 total macro steps.",
    );
  let state = EditorState.create({
    doc: initial.doc,
    selection: initial.selection,
    extensions: [EditorState.allowMultipleSelections.of(true)],
  });
  let combined: ChangeSet = state.changes([]),
    n = 0;
  for (let repetition = 0; repetition < repeat; repetition++)
    for (const step of steps) {
      if (signal?.aborted)
        throw new DOMException("Macro cancelled.", "AbortError");
      const base = state.selection.main.head;
      const changes = step.changes.map((c) => ({
        from: base + c.from,
        to: base + c.to,
        insert: c.insert,
      }));
      for (const c of changes)
        if (
          !Number.isInteger(c.from) ||
          !Number.isInteger(c.to) ||
          c.from < 0 ||
          c.to < c.from ||
          c.to > state.doc.length ||
          typeof c.insert !== "string"
        )
          throw new Error(
            "This macro would edit outside the document. No changes were applied.",
          );
      const changeSet = state.changes(changes),
        newLength = changeSet.newLength;
      const ranges = step.ranges.map((r) => {
        const anchor = base + r.anchor,
          head = base + r.head;
        if (anchor < 0 || head < 0 || anchor > newLength || head > newLength)
          throw new Error(
            "This macro would move outside the document. No changes were applied.",
          );
        return EditorSelection.range(anchor, head);
      });
      const transaction = state.update({
        changes: changeSet,
        selection: EditorSelection.create(ranges, step.main),
      });
      combined = combined.compose(transaction.changes);
      state = transaction.state;
      if (++n % 25 === 0)
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
  return { changes: combined, selection: state.selection };
}

export function readMacros(): TextMacro[] {
  try {
    const parsed = JSON.parse(localStorage.getItem("alder.txt.macros") || "[]");
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (m) =>
              typeof m?.name === "string" &&
              m.name.length <= 100 &&
              Array.isArray(m.steps) &&
              m.steps.length <= 10000,
          )
          .slice(0, 50)
      : [];
  } catch {
    return [];
  }
}
