import {
  StateEffect,
  StateField,
  RangeSet,
  type Text,
} from "@codemirror/state";
import { gutter, GutterMarker, ViewPlugin } from "@codemirror/view";
import {
  StreamLanguage,
  syntaxHighlighting,
  HighlightStyle,
  foldService,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";

export const logLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.match(/\b(?:ERROR|FATAL|CRITICAL)\b/i)) return "invalid";
    if (stream.match(/\b(?:WARN|WARNING)\b/i)) return "keyword";
    if (stream.match(/\b(?:INFO|DEBUG|TRACE)\b/i)) return "labelName";
    if (stream.match(/\d{4}-\d\d-\d\d(?:[T ][\d:.+-]+Z?)?/)) return "number";
    if (stream.match(/https?:\/\/\S+/)) return "link";
    if (stream.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/)) return "string";
    stream.next();
    return null;
  },
});
export const textHighlightStyle = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.invalid, color: "#b82020", fontWeight: "bold" },
    { tag: tags.keyword, color: "#9b5800" },
    { tag: tags.labelName, color: "#426875" },
    { tag: tags.number, color: "#7658a2" },
    { tag: tags.link, color: "#175d9a", textDecoration: "underline" },
    { tag: tags.string, color: "#24712c" },
    { tag: tags.propertyName, color: "#754520" },
  ]),
);
export const indentationFolding = foldService.of((state, start) => {
  const first = state.doc.lineAt(start),
    indent = /^[\t ]*/.exec(first.text)![0].length;
  if (!first.text.trim() || first.number === state.doc.lines) return null;
  let end = first.to;
  for (let n = first.number + 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    if (line.text.trim() && /^[\t ]*/.exec(line.text)![0].length <= indent)
      break;
    end = line.to;
  }
  return end > first.to ? { from: first.to, to: end } : null;
});
export const diskSaved = StateEffect.define<Text>();
/** CodeMirror estimates document height; the visible sheet must use its real box. */
export const sheetGutterHeight = ViewPlugin.define((view) => {
  if (typeof ResizeObserver === "undefined") return {};
  const observer = new ResizeObserver(([entry]) => {
    const height =
      entry.borderBoxSize?.[0]?.blockSize ?? view.contentDOM.offsetHeight;
    view.dom.style.setProperty("--txt-sheet-height", `${height}px`);
  });
  observer.observe(view.contentDOM);
  return {
    destroy() {
      observer.disconnect();
      view.dom.style.removeProperty("--txt-sheet-height");
    },
  };
});
export const dirtyLineField = StateField.define<{
  baseline: Text;
  lines: readonly number[];
}>({
  create: (state) => ({ baseline: state.doc, lines: [] }),
  update(value, tr) {
    for (const effect of tr.effects)
      if (effect.is(diskSaved)) return { baseline: effect.value, lines: [] };
    if (!tr.docChanged) return value;
    if (tr.newDoc.eq(value.baseline))
      return { baseline: value.baseline, lines: [] };
    const lines = new Set(
      value.lines.map((at) => tr.newDoc.lineAt(tr.changes.mapPos(at, 1)).from),
    );
    tr.changes.iterChangedRanges((_a, _b, from, to) => {
      const first = tr.newDoc.lineAt(from).number,
        last = tr.newDoc.lineAt(to).number;
      for (let n = first; n <= last; n++) lines.add(tr.newDoc.line(n).from);
    });
    return {
      baseline: value.baseline,
      lines: [...lines].sort((a, b) => a - b),
    };
  },
});
class ChangedMarker extends GutterMarker {
  toDOM() {
    const span = document.createElement("span");
    span.className = "txt-change-marker";
    span.title = "Changed since file save";
    return span;
  }
}
const changed = new ChangedMarker();
export const dirtyLineGutter = gutter({
  class: "txt-change-gutter",
  markers: (v) =>
    RangeSet.of(
      v.state.field(dirtyLineField).lines.map((at) => changed.range(at)),
    ),
});
