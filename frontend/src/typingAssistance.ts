import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
  type Command,
} from "prosemirror-state";
import { closeHistory } from "prosemirror-history";
import { wrapInList } from "prosemirror-schema-list";

export type TextReplacement = { from: string; to: string };
export type TypingPreferences = {
  smartQuotes: boolean;
  smartDashes: boolean;
  automaticLists: boolean;
  replacements: TextReplacement[];
};
export const typingPreferenceKeys = {
  smartQuotes: "alder.smartQuotes",
  smartDashes: "alder.smartDashes",
  automaticLists: "alder.automaticLists",
  replacements: "alder.textReplacements",
} as const;
export function parseTextReplacements(value: string): TextReplacement[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is TextReplacement =>
        item &&
        typeof item.from === "string" &&
        typeof item.to === "string" &&
        /^[\p{L}\p{M}][\p{L}\p{M}\p{N}'’-]{0,39}$/u.test(item.from) &&
        item.to.length > 0 &&
        item.to.length <= 200 &&
        !/[\r\n\x00-\x1f]/.test(item.to),
    );
  } catch {
    return [];
  }
}
type AppliedRule = {
  transform: Transaction;
  from: number;
  to: number;
  text: string;
};
const typingRuleKey = new PluginKey<AppliedRule | null>("typing-assistance");

/** Backspace immediately after a substitution restores the literal keystrokes. */
export const undoTypingAssistance: Command = (state, dispatch) => {
  const applied = typingRuleKey.getState(state);
  if (!applied) return false;
  if (dispatch) {
    const tr = closeHistory(state.tr);
    for (let i = applied.transform.steps.length - 1; i >= 0; i--)
      tr.step(applied.transform.steps[i].invert(applied.transform.docs[i]));
    tr.insertText(applied.text, applied.from, applied.to);
    tr.setSelection(
      TextSelection.create(tr.doc, applied.from + applied.text.length),
    );
    dispatch(tr.setMeta(typingRuleKey, null));
  }
  return true;
};

/** Authored text only: do not rewrite paste, composition, links or code. */
export function typingTransaction(
  state: EditorState,
  from: number,
  to: number,
  text: string,
  options: TypingPreferences,
): Transaction | null {
  if (from !== to || [...text].length !== 1) return null;
  const position = state.doc.resolve(from);
  if (
    !position.parent.isTextblock ||
    position.parent.type.spec.code ||
    (state.storedMarks || position.marks()).some(
      (mark) => mark.type.name === "code" || mark.type.name === "link",
    ) ||
    position.nodeBefore?.marks.some((mark) => mark.type.name === "link")
  )
    return null;
  const before = position.parent.textBetween(
    0,
    position.parentOffset,
    undefined,
    "\ufffc",
  );
  const remember = (tr: Transaction) =>
    closeHistory(tr).setMeta(typingRuleKey, { transform: tr, from, to, text });
  if (
    options.automaticLists &&
    text === " " &&
    position.parent.type.name === "paragraph"
  ) {
    const numbered = /^(\d{1,9})[.)]$/.exec(before);
    const bullet = /^[-+*]$/.test(before);
    if (
      (numbered || bullet) &&
      !Array.from({ length: position.depth }, (_, index) =>
        position.node(index + 1),
      ).some((node) => node.type.name === "list_item")
    ) {
      const tr = state.tr.delete(from - before.length, from);
      const type =
        state.schema.nodes[numbered ? "ordered_list" : "bullet_list"];
      if (
        type &&
        wrapInList(type, numbered ? { order: Number(numbered[1]) } : undefined)(
          state.apply(tr),
          (wrapped) => {
            for (const step of wrapped.steps) tr.step(step);
            tr.setSelection(
              TextSelection.create(
                tr.doc,
                wrapped.selection.anchor,
                wrapped.selection.head,
              ),
            );
          },
        )
      )
        return remember(tr);
    }
  }
  if (options.smartDashes && text === "-" && before.endsWith("-"))
    return remember(state.tr.insertText("—", from - 1, to));
  if (
    options.smartQuotes &&
    (text === '"' || text === "'") &&
    !/\d$/.test(before)
  ) {
    const opening = !before || /[\s([{—–]$/.test(before);
    return remember(
      state.tr.insertText(
        text === '"' ? (opening ? "“" : "”") : opening ? "‘" : "’",
        from,
        to,
      ),
    );
  }
  if (options.replacements.length && /^[\s.,!?;:]$/.test(text)) {
    const match = /([\p{L}\p{M}][\p{L}\p{M}\p{N}'’-]*)$/u.exec(before);
    if (match && !/[@/.:]$/.test(before.slice(0, match.index))) {
      const replacement = options.replacements.find(
        (item) =>
          item.from.toLocaleLowerCase() === match[1].toLocaleLowerCase(),
      );
      if (replacement) {
        let value = replacement.to;
        if (match[1] === match[1].toLocaleUpperCase())
          value = value.toLocaleUpperCase();
        else if (match[1][0] === match[1][0].toLocaleUpperCase())
          value = value[0].toLocaleUpperCase() + value.slice(1);
        return remember(
          state.tr.insertText(value + text, from - match[1].length, to),
        );
      }
    }
  }
  return null;
}

export function typingAssistance(preferences: () => TypingPreferences | null) {
  return new Plugin<AppliedRule | null>({
    key: typingRuleKey,
    state: {
      init: () => null,
      apply(tr, previous) {
        const applied = tr.getMeta(typingRuleKey);
        if (applied !== undefined) return applied;
        // Block identity assignment appends only attribute changes to the same
        // rule transaction. It must not consume the immediate undo opportunity.
        if (tr.getMeta("appendedTransaction")?.getMeta(typingRuleKey))
          return previous;
        return tr.docChanged || tr.selectionSet ? null : previous;
      },
    },
    props: {
      handleTextInput(view, from, to, text) {
        const options = preferences();
        if (!options || view.composing) return false;
        const tr = typingTransaction(view.state, from, to, text, options);
        if (!tr) return false;
        view.dispatch(tr);
        return true;
      },
      handleKeyDown(view, event) {
        return event.key === "Backspace" &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !view.composing
          ? undoTypingAssistance(view.state, (tr) => view.dispatch(tr))
          : false;
      },
    },
  });
}
