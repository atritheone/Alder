import type { EditorView } from "@codemirror/view";
import type { Annotation } from "./types";
import { bookmarkField } from "./plainTextMarks";

/** Optional document navigation; hidden by default to preserve Write's layout. */
export default function TextOverview({
  view,
  annotations,
}: {
  view: EditorView | null;
  annotations: Annotation[];
}) {
  if (!view) return null;
  const doc = view.state.doc,
    lines = doc.lines,
    current = doc.lineAt(view.state.selection.main.head).number;
  const jump = (line: number) => {
    view.dispatch({
      selection: { anchor: doc.line(Math.max(1, Math.min(lines, line))).from },
      scrollIntoView: true,
    });
    view.focus();
  };
  const position = (line: number) =>
    `${((line - 1) / Math.max(1, lines - 1)) * 98}%`;
  return (
    <aside className="txt-overview" aria-label="Document overview">
      <input
        className="txt-overview-navigation"
        aria-label="Navigate document by line"
        type="range"
        min="1"
        max={lines}
        value={current}
        onChange={(e) => jump(Number(e.target.value))}
      />
      <span
        className="txt-overview-current"
        style={{ top: position(current) }}
      />
      {view.state
        .field(bookmarkField)
        .slice(0, 500)
        .map((at) => {
          const line = doc.lineAt(at).number;
          return (
            <button
              key={at}
              className="txt-overview-bookmark"
              style={{ top: position(line) }}
              aria-label={`Bookmark at line ${line}`}
              title={`Bookmark at line ${line}`}
              onClick={() => jump(line)}
            />
          );
        })}
      {annotations
        .slice(0, 500)
        .filter((a) => a.start >= 0 && a.start <= doc.length)
        .map((a) => {
          const line = doc.lineAt(a.start).number;
          return (
            <button
              key={a.id}
              className="txt-overview-issue"
              style={{ top: position(line) }}
              aria-label={`Suggestion at line ${line}: ${a.message}`}
              title={a.message}
              onClick={() => jump(line)}
            />
          );
        })}
    </aside>
  );
}
