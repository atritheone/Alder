import { useEffect, useRef, useState } from "react";
import { EditorState, Plugin, type Command } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { history, undo, redo, closeHistory } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { baseKeymap, toggleMark } from "prosemirror-commands";
import { schema } from "./Editor";
import {
  setTextStyle,
  setParagraph,
  selectionFormatting,
} from "./editorCommands";
import {
  fieldLabels,
  insertDocumentField,
  type DocumentField,
} from "./documentFields";
import { validStory } from "./runningMatter";
import { styleSheet } from "./styleResolution";
import type { DocNode, NamedStyle } from "./types";
import { Bold, Italic, Underline } from "lucide-react";
import FontSizeField from "./FontSizeField";
import { tabLayout } from "./tabLayout";
import { exactLeading } from "./exactLeading";

/** A separate editor session: cancelling the dialog never touches body history. */
export default function StoryEditor({
  document: source,
  onChange,
  styles,
  fontFamily,
  fields,
  label,
}: {
  document: DocNode;
  onChange: (document: DocNode) => void;
  styles: NamedStyle[];
  fontFamily: string;
  fields: Record<DocumentField, string>;
  label: string;
}) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    latest = useRef(onChange);
  latest.current = onChange;
  const [, setRevision] = useState(0),
    [error, setError] = useState(""),
    [fontInput, setFontInput] = useState(fontFamily);
  const scope = useRef(`story_${crypto.randomUUID()}`);
  useEffect(() => {
    const v = new EditorView(host.current!, {
      state: EditorState.create({
        schema,
        doc: schema.nodeFromJSON(source),
        plugins: [
          history(),
          tabLayout(() => true),
          exactLeading(
            () => styles,
            () => true,
          ),
          new Plugin({
            filterTransaction: (tr) => {
              if (!tr.docChanged || validStory(tr.doc.toJSON())) return true;
              setError(
                "Use formatted paragraphs and fields in a header or footer.",
              );
              return false;
            },
          }),
          keymap({
            "Mod-z": undo,
            "Mod-Shift-z": redo,
            "Mod-y": redo,
            "Mod-b": toggleMark(schema.marks.strong),
            "Mod-i": toggleMark(schema.marks.em),
            "Mod-u": toggleMark(schema.marks.underline),
            Tab: (state, dispatch) => {
              dispatch?.(state.tr.insertText("\t"));
              return true;
            },
          }),
          keymap(baseKeymap),
        ],
      }),
      attributes: {
        role: "textbox",
        "aria-label": label,
        "aria-multiline": "true",
        spellcheck: "false",
      },
      dispatchTransaction(tr) {
        const result = v.state.applyTransaction(tr);
        v.updateState(result.state);
        if (result.transactions.some((t) => t.docChanged)) {
          latest.current(v.state.doc.toJSON());
          setError("");
        }
        setRevision((n) => n + 1);
      },
    });
    view.current = v;
    setRevision((n) => n + 1);
    return () => {
      view.current = null;
      v.destroy();
    };
  }, []);
  const v = view.current,
    format = v
      ? selectionFormatting(v.state, styles, { fontFamily, fontSize: 9 })
      : null;
  useEffect(
    () => setFontInput(format?.fontFamily ?? fontFamily),
    [format?.fontFamily, fontFamily],
  );
  const command = (fn: Command) => {
    const current = view.current;
    if (current) {
      fn(current.state, current.dispatch, current);
      current.focus();
    }
  };
  return (
    <div className="story-editor" data-alder-editor={scope.current}>
      <style>{styleSheet(styles, scope.current)}</style>
      <div
        className="story-toolbar"
        role="toolbar"
        aria-label="Header and footer formatting"
      >
        <label>
          Font
          <input
            aria-label="Header/footer font"
            value={fontInput}
            onChange={(e) => setFontInput(e.target.value)}
            onBlur={(e) => {
              if (
                e.target.value.trim() &&
                e.target.value.trim() !== format?.fontFamily
              )
                command(setTextStyle({ fontFamily: e.target.value.trim() }));
            }}
          />
        </label>
        <FontSizeField
          value={format?.fontSize ?? "9"}
          onApply={(size) => command(setTextStyle({ fontSize: size }))}
        />
        {(
          [
            ["strong", "Bold", Bold],
            ["em", "Italic", Italic],
            ["underline", "Underline", Underline],
          ] as const
        ).map(([mark, name, Glyph]) => (
          <button
            key={mark}
            type="button"
            aria-label={name}
            aria-pressed={format?.marks[mark] === true}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => command(toggleMark(schema.marks[mark]))}
          >
            <Glyph size={16} />
          </button>
        ))}
        <select
          aria-label="Header/footer alignment"
          value={format?.align || "left"}
          onChange={(e) => command(setParagraph({ align: e.target.value }))}
        >
          <option value="left">Left</option>
          <option value="center">Centre</option>
          <option value="right">Right</option>
          <option value="justify">Justify</option>
        </select>
        <select
          aria-label="Insert header/footer field"
          value=""
          onChange={(e) => {
            const current = view.current,
              kind = e.target.value as DocumentField;
            if (current && kind) {
              current.dispatch(
                insertDocumentField(current.state, kind, fields[kind] || "—"),
              );
              current.dispatch(closeHistory(current.state.tr));
              current.focus();
            }
          }}
        >
          <option value="">Insert field…</option>
          {Object.entries(fieldLabels).map(([kind, label]) => (
            <option key={kind} value={kind}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div
        ref={host}
        className="story-editor-content"
        style={{ fontFamily, fontSize: "9pt" }}
      />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
