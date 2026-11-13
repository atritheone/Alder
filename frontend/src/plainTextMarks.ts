import { StateEffect, StateField, RangeSet } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  gutter,
  MatchDecorator,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

export const toggleBookmark = StateEffect.define<number>();
export const clearBookmarks = StateEffect.define<null>();
export const restoreBookmarks = StateEffect.define<readonly number[]>();
export const bookmarkField = StateField.define<readonly number[]>({
  create: () => [],
  toJSON: (value) => value,
  fromJSON: (json, state) =>
    Array.isArray(json)
      ? [
          ...new Set(
            json
              .filter(
                (n): n is number =>
                  Number.isInteger(n) && n >= 0 && n <= state.doc.length,
              )
              .map((n) => state.doc.lineAt(n).from),
          ),
        ].sort((a, b) => a - b)
      : [],
  update(value, tr) {
    if (
      !tr.docChanged &&
      !tr.effects.some(
        (e) =>
          e.is(clearBookmarks) ||
          e.is(toggleBookmark) ||
          e.is(restoreBookmarks),
      )
    )
      return value;
    let next = value.map(
      (at) => tr.newDoc.lineAt(tr.changes.mapPos(at, 1)).from,
    );
    for (const effect of tr.effects) {
      if (effect.is(clearBookmarks)) next = [];
      if (effect.is(restoreBookmarks)) next = [...effect.value];
      if (effect.is(toggleBookmark)) {
        const at = tr.newDoc.lineAt(effect.value).from;
        next = next.includes(at) ? next.filter((n) => n !== at) : [...next, at];
      }
    }
    return [...new Set(next)].sort((a, b) => a - b);
  },
});
class BookmarkMarker extends GutterMarker {
  toDOM() {
    const span = document.createElement("span");
    span.textContent = "●";
    span.title = "Bookmarked line";
    return span;
  }
}
const marker = new BookmarkMarker();
export const bookmarkGutter = gutter({
  class: "txt-bookmark-gutter",
  markers: (view) =>
    RangeSet.of(view.state.field(bookmarkField).map((at) => marker.range(at))),
  initialSpacer: () => marker,
  domEventHandlers: {
    mousedown: (view, line, event) => {
      event.preventDefault();
      view.dispatch({ effects: toggleBookmark.of(line.from) });
      return true;
    },
  },
});
export function nextBookmark(view: EditorView, direction = 1) {
  const all = view.state.field(bookmarkField),
    at = view.state.selection.main.head;
  const next =
    direction > 0
      ? (all.find((n) => n > at) ?? all[0])
      : ([...all].reverse().find((n) => n < at) ?? all.at(-1));
  if (next == null) return false;
  view.dispatch({ selection: { anchor: next }, scrollIntoView: true });
  return true;
}
export const markSelection = StateEffect.define<{
  from: number;
  to: number;
  color: number;
}>();
export const clearMarks = StateEffect.define<null>();
export const restoreMarks = StateEffect.define<DecorationSet>();
export const markOccurrences = StateEffect.define<{
  ranges: readonly { start: number; end: number }[];
  color: number;
}>();
export const markField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  toJSON: (value) => {
    const result: { from: number; to: number; color: number }[] = [];
    value.between(0, 1e12, (from, to, deco) => {
      result.push({
        from,
        to,
        color: Number(String(deco.spec.class).slice(-1)),
      });
    });
    return result;
  },
  fromJSON: (json, state) =>
    Decoration.set(
      (Array.isArray(json) ? json : [])
        .filter(
          (r) =>
            Number.isInteger(r?.from) &&
            Number.isInteger(r?.to) &&
            r.from >= 0 &&
            r.to > r.from &&
            r.to <= state.doc.length &&
            Number.isInteger(r.color) &&
            r.color >= 0 &&
            r.color < 4,
        )
        .map((r) =>
          Decoration.mark({ class: `txt-mark-${r.color}` }).range(r.from, r.to),
        ),
      true,
    ),
  update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(clearMarks)) value = Decoration.none;
      if (effect.is(restoreMarks)) value = effect.value;
      if (effect.is(markOccurrences)) {
        const { ranges, color } = effect.value;
        value = value.update({
          add: ranges
            .filter(
              (r) =>
                r.start >= 0 && r.end > r.start && r.end <= tr.newDoc.length,
            )
            .map((r) =>
              Decoration.mark({ class: `txt-mark-${color % 4}` }).range(
                r.start,
                r.end,
              ),
            ),
          sort: true,
        });
      }
      if (effect.is(markSelection)) {
        const { from, to, color } = effect.value;
        if (from >= 0 && to > from && to <= tr.newDoc.length)
          value = value.update({
            add: [
              Decoration.mark({ class: `txt-mark-${color % 4}` }).range(
                from,
                to,
              ),
            ],
            sort: true,
          });
      }
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
/** Viewport decorations find matches throughout the file as it is scrolled. */
export function occurrenceHighlights(
  options: () => { wholeWord: boolean; caseSensitive: boolean },
) {
  return ViewPlugin.fromClass(
    class {
      matcher: MatchDecorator;
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.matcher = this.create(view);
        this.decorations = this.matcher.createDeco(view);
      }
      create(view: EditorView) {
        const range = view.state.selection.main,
          selected = view.state.sliceDoc(range.from, range.to),
          p = options();
        const escaped = selected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const expression =
          !selected || selected.length > 2000 || /[\r\n]/.test(selected)
            ? "(?!)"
            : p.wholeWord
              ? `(?<![\\p{L}\\p{M}\\p{N}_])${escaped}(?![\\p{L}\\p{M}\\p{N}_])`
              : escaped;
        return new MatchDecorator({
          regexp: new RegExp(expression, p.caseSensitive ? "gu" : "giu"),
          decoration: Decoration.mark({ class: "cm-selectionMatch" }),
        });
      }
      update(update: ViewUpdate) {
        if (update.selectionSet || update.docChanged) {
          this.matcher = this.create(update.view);
          this.decorations = this.matcher.createDeco(update.view);
        } else
          this.decorations = this.matcher.updateDeco(update, this.decorations);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
