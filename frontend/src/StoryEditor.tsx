import { useEffect, useRef, useState } from "react";
import {
  EditorState,
  Plugin,
  TextSelection,
  type Command,
} from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { history, undo, redo, closeHistory } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { baseKeymap, toggleMark, chainCommands } from "prosemirror-commands";
import {
  splitListItem,
  sinkListItem,
  liftListItem,
} from "prosemirror-schema-list";
import { continuedLists, normaliseListOrders } from "./listFormatting";
import { outlineLists } from "./outlineLists";
import { schema, refreshEditorDecorations } from "./Editor";
import { discretionaryHyphens } from "./hyphenation";
import HyphenationFields from "./HyphenationFields";
import {
  setTextStyle,
  setParagraph,
  selectionFormatting,
  toggleList,
} from "./editorCommands";
import {
  fieldLabels,
  insertDocumentField,
  type DocumentField,
} from "./documentFields";
import { validStory } from "./runningMatter";
import { styleSheet } from "./styleResolution";
import type { DocNode, NamedStyle, Asset } from "./types";
import { Bold, Italic, Underline, List, ListOrdered } from "lucide-react";
import FontSizeField from "./FontSizeField";
import { tabLayout } from "./tabLayout";
import { exactLeading } from "./exactLeading";
import { columnResizing, tableEditing, goToNextCell } from "prosemirror-tables";
import { AlderTableView } from "./tableFormatting";
import StoryTableTools from "./StoryTableTools";
import StoryImageTools from "./StoryImageTools";
import { validTextBoxContent } from "./textBoxes";
import { validNoteBody } from "./documentNotes";
import { clipboardSlice, clipboardText } from "./pasteText";

/** A separate editor session: cancelling the dialog never touches body history. */
export default function StoryEditor({
  document: source,
  onChange,
  styles,
  fontFamily,
  fields,
  label,
  language,
  assets,
  projectId,
  onCollect,
  mode = "running",
}: {
  document: DocNode;
  onChange: (document: DocNode) => void;
  styles: NamedStyle[];
  fontFamily: string;
  fields: Record<DocumentField, string>;
  label: string;
  language: string;
  assets: Asset[];
  projectId: string;
  onCollect: (file: File) => Promise<Asset>;
  mode?: "running" | "note" | "textBox" | "form" | "formBlock";
}) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    latest = useRef(onChange);
  latest.current = onChange;
  const context = useRef({styles,assets,projectId});
  context.current = {styles,assets,projectId};
  const [, setRevision] = useState(0),
    [error, setError] = useState(""),
    [fontInput, setFontInput] = useState(fontFamily);
  const [mergeName,setMergeName]=useState<string|null>(null);
  const scope = useRef(`story_${crypto.randomUUID()}`);
  useEffect(() => {
    const v = new EditorView(host.current!, {
      state: EditorState.create({
        schema,
        doc: normaliseListOrders(schema.nodeFromJSON(source)),
        plugins: [
          discretionaryHyphens(
            () => ({ styles, language, enabled: true }),
            refreshEditorDecorations,
            setError,
          ),
          history(),
          continuedLists(),
          outlineLists(),
          columnResizing({ View: AlderTableView, defaultCellMinWidth: 25 }),
          tableEditing(),
          tabLayout(() => true),
          exactLeading(
            () => styles,
            () => true,
          ),
          new Plugin({
            filterTransaction: (tr) => {
              if (
                !tr.docChanged ||
                ((mode === "textBox" || mode === "form")
                  ? tr.doc.childCount === 1 &&
                    tr.doc.firstChild?.type.name === "paragraph" &&
                    validTextBoxContent(tr.doc.firstChild.toJSON().content)
                  : (mode === "note" || mode === "formBlock")
                    ? validNoteBody(tr.doc.toJSON())
                    : validStory(tr.doc.toJSON()))
              )
                return true;
              setError(
                (mode === "textBox" || mode === "form")
                  ? "Use formatted text and line breaks here."
                  : (mode === "note" || mode === "formBlock")
                    ? "Use formatted paragraphs, lists, tables, images and links here."
                    : "Use formatted paragraphs, tables, images and fields in a header or footer.",
              );
              return false;
            },
          }),
          keymap({
            "Mod-Shift-Home": (state, dispatch) => {
              dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, state.selection.anchor, TextSelection.atStart(state.doc).head)).scrollIntoView());
              return true;
            },
            "Mod-Shift-End": (state, dispatch) => {
              dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, state.selection.anchor, TextSelection.atEnd(state.doc).head)).scrollIntoView());
              return true;
            },
            "Mod-Home": (state, dispatch) => {
              dispatch?.(
                state.tr
                  .setSelection(TextSelection.atStart(state.doc))
                  .scrollIntoView(),
              );
              return true;
            },
            "Mod-End": (state, dispatch) => {
              dispatch?.(
                state.tr
                  .setSelection(TextSelection.atEnd(state.doc))
                  .scrollIntoView(),
              );
              return true;
            },
            Enter: (state, dispatch, view) => {
              if ((mode !== "textBox" && mode !== "form"))
                return splitListItem(schema.nodes.list_item)(
                  state,
                  dispatch,
                  view,
                );
              dispatch?.(
                state.tr.replaceSelectionWith(schema.nodes.hard_break.create()),
              );
              return true;
            },
            "Mod-z": undo,
            "Mod-Shift-z": redo,
            "Mod-y": redo,
            "Mod-b": toggleMark(schema.marks.strong),
            "Mod-i": toggleMark(schema.marks.em),
            "Mod-u": toggleMark(schema.marks.underline),
            Tab: (state, dispatch) => {
              if (goToNextCell(1)(state, dispatch)) return true;
              if (
                (mode === "note" || mode === "formBlock") &&
                sinkListItem(schema.nodes.list_item)(state, dispatch)
              )
                return true;
              dispatch?.(state.tr.insertText("\t"));
              return true;
            },
            "Shift-Tab": chainCommands(
              goToNextCell(-1),
              liftListItem(schema.nodes.list_item),
            ),
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
      clipboardTextSerializer: slice => clipboardText(schema,slice),
      handlePaste(v,event) {
        const text=event.clipboardData?.getData("text/plain"),html=event.clipboardData?.getData("text/html") || "";
        if(text===undefined)return false;
        if(!text && !html){if(event.clipboardData?.files.length)setError("Use Insert image to collect image files from the clipboard.");return !!event.clipboardData?.files.length;}
        try {
          let notice="";
          const current=context.current;
          const slice=clipboardSlice(schema,text,html,"source",value=>{notice=value;},new Set(current.styles.map(s=>s.id)),new Map(current.assets.map(a=>[`/api/projects/${current.projectId}/assets/${a.id}`,a.id])));
          v.dispatch(closeHistory(v.state.tr).replaceSelection(slice).setMeta("uiEvent","paste").scrollIntoView());
          v.dispatch(closeHistory(v.state.tr));
          if(notice)setError(notice);
        } catch(cause){setError((cause as Error).message);}
        return true;
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
      ? selectionFormatting(v.state, styles, {
          fontFamily,
          fontSize: (mode === "textBox" || mode === "form" || mode === "formBlock") ? 12 : 9,
        })
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
        aria-label={
          (mode === "textBox" || mode === "form")
            ? (mode === "form" ? "Field formatting" : "Text box formatting")
            : (mode === "note" || mode === "formBlock")
              ? (mode === "formBlock" ? "Field formatting" : "Note formatting")
              : "Header and footer formatting"
        }
      >
        <label>
          Font
          <input
            aria-label={
              (mode === "textBox" || mode === "form")
                ? (mode === "form" ? "Field font" : "Text box font")
                : (mode === "note" || mode === "formBlock")
                  ? (mode === "formBlock" ? "Field font" : "Note font")
                  : "Header/footer font"
            }
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
        {(mode !== "textBox" && mode !== "form") && (
          <select
            aria-label={
              (mode === "note" || mode === "formBlock") ? (mode === "formBlock" ? "Field alignment" : "Note alignment") : "Header/footer alignment"
            }
            value={format?.align || "left"}
            onChange={(e) => command(setParagraph({ align: e.target.value }))}
          >
            <option value="left">Left</option>
            <option value="center">Centre</option>
            <option value="right">Right</option>
            <option value="justify">Justify</option>
          </select>
        )}
        {mode === "running" && (
          <>
            <select
              aria-label="Insert header/footer field"
              value=""
              onChange={(e) => {
                const current = view.current,
                  kind = e.target.value as DocumentField;
                if (current && kind) {
                  current.dispatch(
                    insertDocumentField(
                      current.state,
                      kind,
                      fields[kind] || "—",
                    ),
                  );
                  current.dispatch(closeHistory(current.state.tr));
                  current.focus();
                }
              }}
            >
              <option value="">Insert field…</option>
              {Object.entries(fieldLabels).filter(([kind])=>kind!=="merge").map(([kind, label]) => (
                <option key={kind} value={kind}>
                  {label}
                </option>
              ))}
            </select>
            <StoryTableTools view={v} onError={setError} />
          </>
        )}
        {(mode === "note" || mode === "formBlock") && (
          <>
            {(
              [
                ["bullet_list", "Bulleted list", List],
                ["ordered_list", "Numbered list", ListOrdered],
              ] as const
            ).map(([kind, label, Glyph]) => (
              <button
                key={kind}
                type="button"
                aria-label={label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => command(toggleList(kind))}
              >
                <Glyph size={16} />
              </button>
            ))}
            <StoryTableTools view={v} onError={setError} label={mode === "formBlock" ? "Field table" : "Note table"} />
          </>
        )}
        {(mode!=="textBox" && mode!=="form") && (mergeName===null ? <button type="button" onClick={()=>setMergeName('')}>Merge field…</button> : <>
          <input aria-label="Story merge field name" autoFocus value={mergeName} maxLength={100} onChange={event=>setMergeName(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')event.preventDefault();}}/>
          <button type="button" disabled={!mergeName.trim()} onClick={()=>{try{const current=view.current;if(!current)return;current.dispatch(insertDocumentField(current.state,'merge',`«${mergeName.trim()}»`,undefined,mergeName.trim()));current.dispatch(closeHistory(current.state.tr));setMergeName(null);current.focus();}catch(cause){setError((cause as Error).message);}}}>Insert</button>
          <button type="button" onClick={()=>setMergeName(null)}>Cancel</button>
        </>)}
        {(mode !== "textBox" && mode !== "form") && (
          <StoryImageTools
            label={(mode === "note" || mode === "formBlock") ? (mode === "formBlock" ? "Field" : "Note") : "Header/footer"}
            view={v}
            assets={assets}
            projectId={projectId}
            onCollect={onCollect}
            onError={setError}
          />
        )}
      </div>
      {mode === "running" && (
        <HyphenationFields
          value={format?.paragraph || {}}
          onChange={(patch) => command(setParagraph(patch))}
        />
      )}
      <div
        ref={host}
        className="story-editor-content"
        style={{ fontFamily, fontSize: (mode === "textBox" || mode === "form" || mode === "formBlock") ? "12pt" : "9pt" }}
      />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
