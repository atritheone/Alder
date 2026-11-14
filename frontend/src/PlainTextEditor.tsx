import { changedPlainDocument } from "./plainTextChanges";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
} from "react";
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  Transaction,
  countColumn,
  Prec,
  type EditorSelection,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  highlightWhitespace,
  keymap,
  lineNumbers,
  rectangularSelection,
  crosshairCursor,
  type DecorationSet,
  WidgetType,
} from "@codemirror/view";
import {
  history,
  historyKeymap,
  defaultKeymap,
  indentWithTab,
  undo,
  redo,
  undoDepth,
  isolateHistory,
  copyLineDown,
  moveLineUp,
  moveLineDown,
  deleteLine,
  insertBlankLine,
  selectLine,
} from "@codemirror/commands";
import {
  highlightSelectionMatches,
  gotoLine,
  selectNextOccurrence,
  selectSelectionMatches,
} from "@codemirror/search";
import {
  autocompletion,
  completionKeymap,
  startCompletion,
  acceptCompletion,
  closeBrackets,
} from "@codemirror/autocomplete";
import {
  bracketMatching,
  indentUnit,
  codeFolding,
  foldGutter,
  foldEffect,
  unfoldAll,
} from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import {
  logLanguage,
  textHighlightStyle,
  indentationFolding,
  dirtyLineField,
  dirtyLineGutter,
  sheetGutterHeight,
  diskSaved,
} from "./plainTextViews";
import { completeDocumentWord, documentWords } from "./plainTextCompletion";
import { projectHistoryCommand } from "./projectHistoryBridge";
import { useTextPreferences } from "./TextEditorSettings";
import {
  textEditorSession,
  registerTextSession,
  portableTextState,
} from "./plainTextSessions";
import { withinEditorEdit } from "./projectTimeline";
import type { Extension } from "@codemirror/state";
import {
  bookmarkField,
  bookmarkGutter,
  toggleBookmark,
  nextBookmark,
  markField,
  markOccurrences,
  clearMarks,
  clearBookmarks,
  restoreBookmarks,
  restoreMarks,
  occurrenceHighlights,
} from "./plainTextMarks";
import { persistTextMetadata, readTextMetadata } from "./plainTextMetadata";
import TextOverview from "./TextOverview";
import { findText } from "./findText";
import type Editor from "./Editor";
import type { EditorHandle } from "./Editor";
import { documentText } from "./textProjection";
import { textDoc } from "./api";
import {
  transformText,
  plainTextDocument,
  type TextOperation,
} from "./plainTextTools";
import "./plain-text-editor.css";
import { useStoredPreference } from "./useStoredPreference";
import type { Annotation } from "./types";
import TextAutomationTools from "./TextAutomationTools";
import TextColumnTools from "./TextColumnTools";
import TextInsertionTools from "./TextInsertionTools";
import { copyText } from "./clipboardText";
import TextCommandPalette from "./TextCommandPalette";
import {
  readShortcutMap,
  shortcutError,
  normalizeShortcut,
  type TextCommand,
} from "./textCommands";
import {
  dispatchSharedTextViews,
  synchronizeTextViews,
} from "./sharedTextViews";
import FontSizeField from "./FontSizeField";
import WriteToolbar from "./WriteToolbar";
import { useFontCatalogue } from "./useInstalledFonts";
import { DOCUMENT_FONT } from "./fontCatalogue";
import {
  Undo2,
  Redo2,
  Search,
  WrapText,
  ListOrdered,
  Pilcrow,
  Ellipsis,
} from "lucide-react";

type Props = ComponentProps<typeof Editor>;
const issues = StateEffect.define<readonly Annotation[]>();
class InsertionIssue extends WidgetType {
  constructor(readonly annotation: Annotation) {
    super();
  }
  eq(other: InsertionIssue) {
    return (
      this.annotation.id === other.annotation.id &&
      this.annotation.message === other.annotation.message
    );
  }
  toDOM() {
    const marker = document.createElement("span");
    marker.className = "annotation-insertion";
    marker.textContent = "⌃";
    marker.setAttribute("role", "note");
    marker.setAttribute("aria-label", this.annotation.message);
    marker.dataset.proofreadingId = this.annotation.id;
    return marker;
  }
  ignoreEvent() {
    return false;
  }
}
const issueField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    if (tr.docChanged) value = Decoration.none;
    for (const effect of tr.effects)
      if (effect.is(issues))
        value = Decoration.set(
          effect.value
            .filter(
              (a) =>
                Number.isInteger(a.start) &&
                Number.isInteger(a.end) &&
                a.start >= 0 &&
                a.end >= a.start &&
                a.end <= tr.newDoc.length,
            )
            .filter((a) => a.end > a.start || a.alternatives?.length)
            .map((a) =>
              a.end === a.start
                ? Decoration.widget({
                    widget: new InsertionIssue(a),
                    side: 1,
                  }).range(a.start)
                : Decoration.mark({
                    class: `annotation annotation-${a.type}${a.type === "spelling" ? "" : " annotation-grammar"}`,
                    attributes: {
                      title: a.message,
                      "aria-description": a.message,
                      "data-proofreading-id": a.id,
                    },
                  }).range(a.start, a.end),
            ),
          true,
        );
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
const reading = StateEffect.define<{ start: number; end: number } | null>();
const readingField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects)
      if (effect.is(reading)) {
        const range = effect.value;
        const start = Math.min(
            tr.newDoc.length,
            Math.max(0, range?.start || 0),
          ),
          end = Math.min(tr.newDoc.length, Math.max(0, range?.end || 0));
        value =
          range && end > start
            ? Decoration.set([
                Decoration.mark({ class: "txt-reading" }).range(start, end),
              ])
            : Decoration.none;
      }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
const operations: [string, TextOperation][] = [
  ["Uppercase", "upper"],
  ["Lowercase", "lower"],
  ["Title case", "title"],
  ["Sentence case", "sentence"],
  ["Invert case", "invert"],
  ["Trim trailing whitespace", "trim-end"],
  ["Trim leading whitespace", "trim-start"],
  ["Trim both ends", "trim"],
  ["Remove empty lines", "remove-empty"],
  ["Remove blank lines", "remove-blank"],
  ["Remove duplicate lines", "unique"],
  ["Remove consecutive duplicates", "unique-adjacent"],
  ["Sort ascending", "sort"],
  ["Sort descending", "sort-desc"],
  ["Sort naturally", "sort-natural"],
  ["Reverse lines", "reverse"],
  ["Join lines", "join"],
  ["Sort ignoring case", "sort-insensitive"],
  ["Sort numbers first", "sort-numeric"],
  ["Tabs to spaces", "tabs-spaces"],
  ["Leading spaces to tabs", "spaces-tabs"],
];

export default forwardRef<EditorHandle, Props>(
  function PlainTextEditor(props, ref) {
    const host = useRef<HTMLDivElement>(null),
      view = useRef<EditorView | null>(null),
      latest = useRef(props);
    const lastPlainDocument = useRef(props.document);
    const peers = useRef(new Set<EditorView>()),
      secondaryHost = useRef<HTMLDivElement>(null);
    const [split, setSplit] = useState(false),
      [synchronisedScroll, setSynchronisedScroll] = useState(false);
    const syncScrollRef = useRef(synchronisedScroll);
    syncScrollRef.current = synchronisedScroll;
    latest.current = props;
    const preferences = useTextPreferences();
    const {
      wrap,
      setWrap,
      whitespace,
      setWhitespace,
      numbers,
      setNumbers,
      fontSize: configuredFontSize,
      setFontSize,
      tabSize,
      setTabSize,
      font: configuredFont,
      completion,
      threshold,
    } = preferences;
    const font = configuredFont || props.fontFamily || DOCUMENT_FONT;
    const showWhitespace = whitespace && !props.suppressChecks;
    const fontSize = preferences.inheritFontSize
      ? props.fontSize || 16
      : configuredFontSize;
    const fontCatalogue = useFontCatalogue(font);
    const [toolsOpen, setToolsOpen] = useState(false);
    const [overview, setOverview] = useStoredPreference(
      "alder.txt.overview",
      "false",
    );
    const currentPreferences = useRef(preferences);
    currentPreferences.current = preferences;
    const [status, setStatus] = useState(""),
      [message, setMessage] = useState("");
    const [, repaintMarkers] = useState(0);
    const [palette, setPalette] = useState(false);
    const [shortcutMap, setShortcutMap] = useStoredPreference(
      "alder.txt.shortcuts",
      "{}",
    );
    const commandsRef = useRef<TextCommand[]>([]);
    const pathRequested = useRef(false);
    const [writeChecks] = useStoredPreference("alder.writeSpellcheck", "true");
    const [syntax, setSyntax] = useStoredPreference(
      "alder.txt.syntax." + props.identity,
      "plain",
    );
    const config = useRef(new Compartment());
    const liveExtensions = useRef<Extension[]>([]);
    const metadataTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const metadataDirty = useRef(false);
    const selectionInteraction = useRef(0);
    const restoredSelection = useRef<{
      doc: Text;
      selection: EditorSelection;
    } | null>(null);
    const [overwrite, setOverwrite] = useState(false);
    const [readOnlyValue, setReadOnlyValue] = useStoredPreference(
      "alder.txt.readOnly." + props.identity,
      "false",
    );
    const readOnly = readOnlyValue === "true",
      setReadOnly = (value: boolean) => setReadOnlyValue(String(value));
    const overwriteRef = useRef(overwrite);
    overwriteRef.current = overwrite;
    const macroRecorder = useRef<((tr: Transaction) => void) | null>(null);
    const insert = (text: string) => {
      const v = view.current;
      if (v?.state.readOnly) throw new Error("This TXT document is read-only.");
      if (v)
        v.dispatch(v.state.replaceSelection(text), {
          scrollIntoView: true,
          userEvent: "input",
        });
    };
    const select = (start: number, end = start) => {
      const v = view.current;
      if (v) {
        const length = v.state.doc.length;
        v.dispatch({
          selection: {
            anchor: Math.min(length, Math.max(0, start)),
            head: Math.min(length, Math.max(0, end)),
          },
          scrollIntoView: true,
        });
        v.focus();
      }
    };
    const unsupported = (): never => {
      throw new Error(
        "This command requires a rich document. TXT preserves plain text only.",
      );
    };
    const historyCommand = (direction: "undo" | "redo") => (v: EditorView) =>
      v.state.readOnly
        ? true
        : (projectHistoryCommand(latest.current.projectId, direction, true) ??
          (direction === "undo" ? undo(v) : redo(v)));
    const replaceRanges: EditorHandle["replaceMatches"] = (
      matches,
      replacement,
      expected,
    ) => {
      const v = view.current;
      if (v?.state.readOnly) throw new Error("This TXT document is read-only.");
      if (!v || v.state.doc.toString() !== expected)
        throw new Error("The document changed. Search again before replacing.");
      const ordered = [...matches].sort((a, b) => a.start - b.start);
      for (let i = 0; i < ordered.length; i++)
        if (
          ordered[i].start < 0 ||
          ordered[i].end <= ordered[i].start ||
          ordered[i].end > expected.length ||
          (i && ordered[i].start < ordered[i - 1].end)
        )
          throw new Error("Invalid replacement ranges.");
      v.dispatch({
        changes: ordered.map((m) => ({
          from: m.start,
          to: m.end,
          insert: m.replacement ?? replacement,
        })),
        userEvent: "input.replace",
      });
    };
    const applyProofreading: EditorHandle["applyProofreading"] = (
      edits,
      expected,
    ) => {
      const v = view.current;
      if (v?.state.readOnly) throw new Error("This TXT document is read-only.");
      if (!v || v.state.doc.toString() !== expected)
        throw new Error(
          "This suggestion refers to earlier text. Check this passage again.",
        );
      const sorted = [...edits].sort(
        (a, b) => a.start - b.start || a.end - b.end,
      );
      if (!sorted.length || sorted.length > 20)
        throw new Error("Invalid correction group.");
      for (let i = 0; i < sorted.length; i++) {
        const e = sorted[i],
          p = sorted[i - 1];
        if (
          !Number.isInteger(e.start) ||
          !Number.isInteger(e.end) ||
          e.start < 0 ||
          e.end < e.start ||
          e.end > expected.length ||
          typeof e.replacement !== "string" ||
          /[\r\n\t]/.test(e.replacement) ||
          expected.slice(e.start, e.end) !== e.originalText ||
          (p && (e.start < p.end || e.start === p.start))
        )
          throw new Error(
            "This correction is overlapping or its source has changed.",
          );
      }
      v.dispatch({
        changes: sorted.map((e) => ({
          from: e.start,
          to: e.end,
          insert: e.replacement,
        })),
        userEvent: "input.proofreading",
      });
    };
    useImperativeHandle(ref, () => ({
      getIdentity: () => latest.current.identity,
      getText: () => view.current?.state.doc.toString() || "",
      getSelection: () => {
        const v = view.current;
        return v
          ? v.state.sliceDoc(
              v.state.selection.main.from,
              v.state.selection.main.to,
            )
          : "";
      },
      getSelectionOffsets: () => {
        const r = view.current?.state.selection.main;
        return { start: r?.from || 0, end: r?.to || 0 };
      },
      hasFocus: () => !!view.current?.hasFocus,
      focus: () => view.current?.focus(),
      insert,
      replace: insert,
      replaceRange: (start, end, text) => {
        const v = view.current;
        if (v?.state.readOnly)
          throw new Error("This TXT document is read-only.");
        if (v)
          v.dispatch({
            changes: { from: start, to: end, insert: text },
            userEvent: "input.replace",
          });
      },
      replaceMatches: replaceRanges,
      replaceAll: (find, replacement) => {
        const v = view.current;
        if (!v || !find) return;
        const text = v.state.doc.toString(),
          matches = [];
        let at = 0;
        while ((at = text.indexOf(find, at)) >= 0) {
          matches.push({ start: at, end: at + find.length });
          at += find.length;
        }
        replaceRanges(matches, replacement, text);
      },
      selectRange: select,
      selectReviewRange: select,
      getDocumentPosition: () => ({
        top: view.current?.scrollDOM.scrollTop || 0,
        left: view.current?.scrollDOM.scrollLeft || 0,
        offset: view.current?.state.selection.main.head || 0,
      }),
      restoreDocumentPosition: (position) => {
        const v = view.current,
          restored = restoredSelection.current;
        if (v && restored?.doc === v.state.doc)
          v.dispatch({ selection: restored.selection });
        else select(position.offset);
        if (view.current) {
          view.current.scrollDOM.scrollTop = position.top;
          view.current.scrollDOM.scrollLeft = position.left;
        }
      },
      getSpeechText: (start, end) => {
        const text =
          view.current?.state.sliceDoc(start, end > start ? end : undefined) ||
          "";
        const offsets: number[] = [],
          endOffsets = [0];
        let at = 0;
        for (const c of text) {
          offsets.push(at);
          at += c.length;
          endOffsets.push(at);
        }
        offsets.push(at);
        return { text, offsets, endOffsets };
      },
      setReadingRange: (range) =>
        view.current?.dispatch({ effects: reading.of(range) }),
      applyProofreading,
      runMenuCommand: (label) => {
        const v = view.current;
        if (!v) return false;
        if (/^undo/i.test(label)) return historyCommand("undo")(v);
        if (/^redo/i.test(label)) return historyCommand("redo")(v);
        return false;
      },
      isLayoutReady: () => true,
      getFormatting: () => null,
      pageAtTextOffset: () => null,
      getPagePublication: unsupported,
      navigateHeading: unsupported,
      navigateBookmark: unsupported,
      openComment: unsupported,
      navigateReference: unsupported,
      accessibilityTarget: unsupported,
      moveHeading: unsupported,
      format: unsupported,
      paragraph: unsupported,
      moveUnit: unsupported,
      insertDocument: (doc) => insert(documentText(doc)),
      navigatePage: unsupported,
      movePage: unsupported,
      image: unsupported,
      field: unsupported,
      prepareField: unsupported,
      contents: unsupported,
      citationSelection: () => undefined,
      prepareCitation: unsupported,
      prepareContents: unsupported,
      resolvePageReferences: unsupported,
      link: unsupported,
      reference: unsupported,
      style: unsupported,
    }));
    useEffect(() => {
      metadataDirty.current = false;
      const text = documentText(latest.current.document),
        saved = textEditorSession(props.identity);
      const extensions = [
        history(),
        EditorState.transactionExtender.of((tr) =>
          tr.docChanged &&
          !tr.isUserEvent("input.type") &&
          !tr.isUserEvent("delete") &&
          tr.annotation(Transaction.addToHistory) !== false
            ? { annotations: isolateHistory.of("full") }
            : null,
        ),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        EditorState.transactionFilter.of((tr) =>
          tr.startState.readOnly && tr.docChanged ? [] : tr,
        ),
        rectangularSelection(),
        crosshairCursor(),
        highlightSpecialChars(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        issueField,
        bracketMatching(),
        codeFolding(),
        foldGutter({
          markerDOM(open) {
            const ns = "http://www.w3.org/2000/svg";
            const marker = document.createElement("span");
            marker.className = "txt-fold-control";
            marker.title = open ? "Fold line" : "Unfold line";
            const icon = document.createElementNS(ns, "svg");
            icon.setAttribute("viewBox", "0 0 8 12");
            icon.setAttribute("width", "8");
            icon.setAttribute("height", "100%");
            icon.setAttribute("aria-hidden", "true");
            icon.setAttribute("focusable", "false");
            const path = document.createElementNS(ns, "path");
            path.setAttribute("d", open ? "M1 4 L4 7 L7 4" : "M2 2 L6 6 L2 10");
            path.setAttribute("fill", "none");
            path.setAttribute("stroke", "currentColor");
            path.setAttribute("stroke-width", "1.3");
            icon.appendChild(path);
            marker.appendChild(icon);
            return marker;
          },
        }),
        dirtyLineField,
        dirtyLineGutter,
        sheetGutterHeight,
        EditorView.inputHandler.of((v, from, to, text) => {
          if (
            !overwriteRef.current ||
            v.composing ||
            v.state.readOnly ||
            from !== to ||
            /[\r\n]/.test(text) ||
            v.state.selection.ranges.length !== 1
          )
            return false;
          const line = v.state.doc.lineAt(from),
            tail = v.state.sliceDoc(from, line.to),
            length = Array.from(tail)
              .slice(0, Array.from(text).length)
              .join("").length;
          v.dispatch({
            changes: { from, to: from + length, insert: text },
            selection: { anchor: from + text.length },
            userEvent: "input.type",
          });
          return true;
        }),
        bookmarkField,
        bookmarkGutter,
        markField,
        documentWords,
        autocompletion({
          override: [
            async (context) => {
              if (pathRequested.current) {
                pathRequested.current = false;
                if (!window.alder?.completeTextPath) return null;
                const range = context.state.selection.main,
                  line = context.state.doc.lineAt(range.head),
                  before = context.state.sliceDoc(line.from, range.head),
                  selected = context.state.sliceDoc(range.from, range.to);
                const match =
                  selected ||
                  /(?:[A-Za-z]:[\\/]|\\\\|\/|\.\.?[\\/])[^\r\n"']*$/.exec(
                    before,
                  )?.[0];
                if (!match) return null;
                const options = await window.alder.completeTextPath(
                  latest.current.projectId,
                  match,
                );
                if (context.aborted) return null;
                return {
                  from: selected ? range.from : range.head - match.length,
                  to: selected ? range.to : undefined,
                  options: options.map((option) => ({
                    label: option.label,
                    type: option.directory ? "namespace" : "text",
                  })),
                };
              }
              const p = currentPreferences.current;
              if (
                !context.explicit &&
                (!p.completion ||
                  (context.matchBefore(/[\p{L}\p{M}\p{N}_]+/u)?.text.length ||
                    0) < p.threshold)
              )
                return null;
              return completeDocumentWord(context);
            },
          ],
          activateOnTypingDelay: 120,
          interactionDelay: 0,
        }),
        readingField,
        keymap.of([
          {
            key: "Mod-Shift-p",
            run: () => {
              setPalette(true);
              return true;
            },
          },
          {
            key: "Insert",
            run: () => {
              setOverwrite((value) => !value);
              return true;
            },
          },
          {
            key: "Enter",
            run: (v) => {
              if (v.state.readOnly) return true;
              if (acceptCompletion(v)) return true;
              if (currentPreferences.current.autoIndent) return false;
              v.dispatch(v.state.replaceSelection("\n"), {
                scrollIntoView: true,
                userEvent: "input.type",
              });
              return true;
            },
          },
          {
            key: "Mod-F2",
            run: (v) => {
              v.dispatch({
                effects: toggleBookmark.of(v.state.selection.main.head),
              });
              return true;
            },
          },
          { key: "F2", run: (v) => nextBookmark(v) },
          { key: "Shift-F2", run: (v) => nextBookmark(v, -1) },
          { key: "Mod-z", run: historyCommand("undo") },
          { key: "Mod-Shift-z", run: historyCommand("redo") },
          { key: "Mod-y", run: historyCommand("redo") },
          { key: "Mod-Space", run: startCompletion },
          {
            key: "Ctrl-Alt-Space",
            run: (v) => {
              pathRequested.current = true;
              return startCompletion(v);
            },
          },
          { key: "Mod-Enter", run: startCompletion },
          { key: "Tab", run: acceptCompletion },
          { key: "Mod-g", run: gotoLine },
          { key: "Mod-d", run: selectNextOccurrence },
          { key: "Mod-Shift-l", run: selectSelectionMatches },
          ...completionKeymap,
          ...historyKeymap,
          indentWithTab,
          ...defaultKeymap,
        ]),
        config.current.of([]),
        EditorView.contentAttributes.of({
          "aria-label": "TXT text editor",
          spellcheck: "false",
        }),
        EditorView.domEventHandlers({
          click: (event) => {
            const target = (event.target as Element)?.closest(
              "[data-proofreading-id]",
            );
            if (target)
              window.dispatchEvent(
                new CustomEvent("alder-proofreading-select", {
                  detail: target.getAttribute("data-proofreading-id"),
                }),
              );
          },
          keydown: () => {
            selectionInteraction.current++;
            restoredSelection.current = null;
          },
          mousedown: () => {
            selectionInteraction.current++;
            restoredSelection.current = null;
          },
          focus: (_event, focused) => {
            view.current = focused;
            latest.current.onFocus?.();
          },
          scroll: (event, source) => {
            if (!syncScrollRef.current || event.target !== source.scrollDOM)
              return;
            const fraction =
              source.scrollDOM.scrollTop /
              Math.max(
                1,
                source.scrollDOM.scrollHeight - source.scrollDOM.clientHeight,
              );
            for (const peer of peers.current)
              if (peer !== source) {
                const target =
                  fraction *
                  Math.max(
                    0,
                    peer.scrollDOM.scrollHeight - peer.scrollDOM.clientHeight,
                  );
                if (Math.abs(peer.scrollDOM.scrollTop - target) > 1)
                  peer.scrollDOM.scrollTop = target;
              }
          },
        }),
        EditorView.updateListener.of((update) => {
          const v = update.view;
          for (const transaction of update.transactions)
            macroRecorder.current?.(transaction);
          if (
            update.state.field(bookmarkField) !==
              update.startState.field(bookmarkField) ||
            update.state.field(markField) !==
              update.startState.field(markField) ||
            update.selectionSet ||
            update.docChanged
          ) {
            metadataDirty.current = true;
            repaintMarkers((n) => n + 1);
            if (metadataTimer.current) clearTimeout(metadataTimer.current);
            metadataTimer.current = setTimeout(() => {
              metadataTimer.current = null;
              void persistTextMetadata(latest.current.identity, v.state).catch(
                () =>
                  setMessage(
                    "Text is saved normally, but editor position and marks could not be remembered.",
                  ),
              );
            }, 750);
          }
          if (
            update.docChanged &&
            update.transactions.some(
              (tr) => tr.annotation(Transaction.addToHistory) !== false,
            )
          ) {
            const text = v.state.doc.toString();
            withinEditorEdit(
              {
                engine: "plain",
                projectId: latest.current.projectId,
                identity: latest.current.identity,
                before: portableTextState(update.startState),
                after: portableTextState(update.state),
                joined:
                  undoDepth(update.startState) === undoDepth(update.state),
              },
              () => {
                const document = changedPlainDocument(lastPlainDocument.current,
                  update.startState.doc, update.state.doc, update.changes);
                lastPlainDocument.current = document;
                latest.current.onChange(document, text);
              },
            );
          }
          if (update.docChanged || update.selectionSet) {
            window.dispatchEvent(new Event("alder-proofreading-caret"));
            const r = v.state.selection.main,
              line = v.state.doc.lineAt(r.head);
            const selected = v.state.sliceDoc(r.from, r.to);
            const word =
              selected ||
              /[\p{L}\p{M}\p{N}_]+$/u.exec(
                v.state.sliceDoc(line.from, r.head),
              )?.[0] ||
              "";
            latest.current.onSelection(word, selected, {
              from: r.from,
              to: r.to,
            });
            latest.current.onTextStatus?.(
              `Line ${line.number} of ${v.state.doc.lines} · Col ${countColumn(line.text, v.state.tabSize, r.head - line.from) + 1}`,
            );
            const lastLine = v.state.doc.lineAt(r.to),
              selectedLines = r.empty
                ? 0
                : lastLine.number -
                  v.state.doc.lineAt(r.from).number +
                  1 -
                  (lastLine.from === r.to ? 1 : 0);
            setStatus(
              `Ln ${line.number}, Col ${countColumn(line.text, v.state.tabSize, r.head - line.from) + 1} · ${v.state.doc.lines} lines · ${Array.from(selected).length} characters / ${selectedLines} lines selected · ${v.state.selection.ranges.length} cursor(s)`,
            );
          }
        }),
      ];
      liveExtensions.current = extensions;
      const state =
        saved && saved.doc.toString() === text
          ? saved.update({ effects: StateEffect.reconfigure.of(extensions) })
              .state
          : EditorState.create({ doc: text, extensions });
      const v = new EditorView({
        state,
        parent: host.current!,
        dispatchTransactions: (transactions, source) =>
          dispatchSharedTextViews(peers.current, transactions, source),
      });
      view.current = v;
      peers.current.add(v);
      const release = registerTextSession(
        props.projectId,
        props.identity,
        () => view.current?.state || v.state,
      );
      let disposed = false;
      const initialInteraction = selectionInteraction.current;
      void readTextMetadata(props.identity, state).then((restored) => {
        if (
          !disposed &&
          restored &&
          v.state.doc === state.doc &&
          !v.state.field(bookmarkField).length &&
          v.state.field(markField).size === 0
        ) {
          const selection =
            selectionInteraction.current === initialInteraction
              ? restored.selection
              : undefined;
          if (selection)
            restoredSelection.current = { doc: v.state.doc, selection };
          v.dispatch({
            selection,
            effects: [
              restoreBookmarks.of(restored.field(bookmarkField)),
              restoreMarks.of(restored.field(markField)),
            ],
          });
        }
      });
      return () => {
        disposed = true;
        if (metadataTimer.current) {
          clearTimeout(metadataTimer.current);
          metadataTimer.current = null;
        }
        if (metadataDirty.current)
          void persistTextMetadata(props.identity, v.state).catch(() => {});
        release(view.current?.state || v.state);
        for (const peer of peers.current) peer.destroy();
        peers.current.clear();
        view.current = null;
      };
    }, [props.identity]);
    useEffect(() => {
      if (!split || !secondaryHost.current) return;
      const primary = [...peers.current][0];
      if (!primary) return;
      const secondary = new EditorView({
        state: primary.state,
        parent: secondaryHost.current,
        dispatchTransactions: (transactions, source) =>
          dispatchSharedTextViews(peers.current, transactions, source),
      });
      secondary.contentDOM.setAttribute("aria-label", "TXT secondary view");
      peers.current.add(secondary);
      return () => {
        if (view.current === secondary) view.current = primary;
        if (peers.current.delete(secondary)) secondary.destroy();
      };
    }, [split, props.identity]);
    useEffect(() => {
      if (props.document === lastPlainDocument.current) return;
      lastPlainDocument.current = props.document;
      const v = view.current,
        text = documentText(props.document);
      if (v && v.state.doc.toString() !== text) {
        const saved = textEditorSession(props.identity);
        if (saved && saved.doc.toString() === text) {
          v.setState(
            saved.update({
              effects: [
                StateEffect.reconfigure.of(liveExtensions.current),
                config.current.reconfigure(config.current.get(v.state) || []),
              ],
            }).state,
          );
          synchronizeTextViews(v, peers.current);
        } else
          v.dispatch({
            changes: { from: 0, to: v.state.doc.length, insert: text },
            annotations: Transaction.addToHistory.of(false),
          });
      }
    }, [props.document, props.identity]);
    useEffect(() => {
      view.current?.dispatch({
        effects: reading.of(props.readingRange || null),
      });
    }, [props.readingRange]);
    useEffect(() => {
      const saved = (event: Event) => {
        const detail = (
            event as CustomEvent<{ projectId: string; text: string }>
          ).detail,
          v = view.current;
        if (
          v &&
          detail.projectId === latest.current.projectId &&
          detail.text === v.state.doc.toString()
        )
          v.dispatch({ effects: diskSaved.of(v.state.doc) });
      };
      window.addEventListener("alder-document-written", saved);
      return () => window.removeEventListener("alder-document-written", saved);
    }, []);
    useEffect(() => {
      const v = view.current;
      if (v)
        v.dispatch({
          effects: issues.of(
            writeChecks !== "false" &&
              !props.suppressChecks &&
              (props.annotationText ?? v.state.doc.toString()) ===
                v.state.doc.toString()
              ? props.annotations || []
              : [],
          ),
        });
    }, [
      props.annotations,
      props.annotationText,
      props.suppressChecks,
      props.document,
      writeChecks,
    ]);
    useEffect(() => {
      view.current?.dispatch({
        effects: config.current.reconfigure([
          ...(wrap ? [EditorView.lineWrapping] : []),
          ...(numbers ? [lineNumbers()] : []),
          ...(showWhitespace ? [highlightWhitespace()] : []),
          occurrenceHighlights(() => currentPreferences.current),
          Prec.highest(
            keymap.of(
              Object.entries(readShortcutMap(shortcutMap))
                .filter(
                  ([id, key]) =>
                    commandsRef.current.some((c) => c.id === id) &&
                    !shortcutError(key, id, readShortcutMap(shortcutMap)),
                )
                .map(([id, key]) => ({
                  key: normalizeShortcut(key),
                  run: () => {
                    commandsRef.current.find((c) => c.id === id)?.run();
                    return true;
                  },
                })),
            ),
          ),
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          indentUnit.of(preferences.useTabs ? "\t" : " ".repeat(tabSize)),
          ...(preferences.autoPairs ? [closeBrackets()] : []),
          indentationFolding,
          textHighlightStyle,
          ...(syntax === "json"
            ? [json()]
            : syntax === "log"
              ? [logLanguage]
              : []),
          EditorState.tabSize.of(tabSize),
          EditorView.theme({
            "&": {
              fontFamily: font,
              fontSize: `${fontSize * (props.pageLayout?.zoom || 1)}px`,
            },
            ".cm-content": {
              fontFamily: font,
              lineHeight: String(props.pageLayout?.lineHeight || 1.2),
            },
            // Gutter labels use the same font metrics as the first visual line.
            // CodeMirror measures each logical line's height, including wrapping
            // and paragraph spacing, and positions its gutter element for us.
            ".cm-gutters": {
              fontFamily: font,
              fontSize: "inherit",
              lineHeight: String(props.pageLayout?.lineHeight || 1.2),
            },
          }),
        ]),
      });
    }, [
      wrap,
      numbers,
      showWhitespace,
      fontSize,
      tabSize,
      font,
      preferences.wholeWord,
      preferences.caseSensitive,
      preferences.useTabs,
      preferences.autoPairs,
      readOnly,
      syntax,
      shortcutMap,
      props.identity,
      props.pageLayout?.zoom,
      props.pageLayout?.lineHeight,
    ]);
    const run = (action: (view: EditorView) => unknown) => {
      const v = view.current;
      if (v) {
        action(v);
        v.focus();
      }
    };
    const transform = (operation: TextOperation) =>
      run((v) => {
        if (v.state.readOnly) {
          setMessage("Disable read-only mode to edit text.");
          return;
        }
        const r = v.state.selection.main,
          from = r.empty ? 0 : r.from,
          to = r.empty ? v.state.doc.length : r.to;
        const text = v.state.sliceDoc(from, to),
          replacement = transformText(text, operation, tabSize);
        if (text !== replacement)
          v.dispatch({
            changes: { from, to, insert: replacement },
            selection: { anchor: from, head: from + replacement.length },
            userEvent: "input.transform",
          });
      });
    commandsRef.current = [
      ...operations.map(([label, id]) => ({
        id: "operation:" + id,
        label,
        run: () => transform(id),
      })),
      { id: "goto", label: "Go to line and column", run: () => run(gotoLine) },
      {
        id: "complete",
        label: "Complete word from current file",
        run: () => run(startCompletion),
      },
      {
        id: "complete-path",
        label: "Complete filesystem path",
        run: () =>
          run((v) => {
            pathRequested.current = true;
            return startCompletion(v);
          }),
      },
      { id: "wrap", label: "Toggle word wrap", run: () => setWrap(!wrap) },
      {
        id: "numbers",
        label: "Toggle line numbers",
        run: () => setNumbers(!numbers),
      },
      {
        id: "whitespace",
        label: "Toggle visible whitespace",
        run: () => {
          if (!latest.current.suppressChecks) setWhitespace(!whitespace);
        },
      },
      {
        id: "bookmark",
        label: "Toggle line bookmark",
        run: () =>
          run((v) =>
            v.dispatch({
              effects: toggleBookmark.of(v.state.selection.main.head),
            }),
          ),
      },
      {
        id: "bookmark-next",
        label: "Next line bookmark",
        run: () => run((v) => nextBookmark(v)),
      },
      {
        id: "bookmark-previous",
        label: "Previous line bookmark",
        run: () => run((v) => nextBookmark(v, -1)),
      },
      {
        id: "duplicate",
        label: "Duplicate line",
        run: () => run(copyLineDown),
      },
      { id: "line-up", label: "Move line up", run: () => run(moveLineUp) },
      {
        id: "line-down",
        label: "Move line down",
        run: () => run(moveLineDown),
      },
      { id: "delete-line", label: "Delete line", run: () => run(deleteLine) },
      {
        id: "select-next",
        label: "Select next occurrence",
        run: () => run(selectNextOccurrence),
      },
      {
        id: "select-all-occurrences",
        label: "Select all occurrences",
        run: () => run(selectSelectionMatches),
      },
      {
        id: "expand",
        label: "Expand all folded text",
        run: () => run(unfoldAll),
      },
      {
        id: "readonly",
        label: "Toggle read-only mode",
        run: () => setReadOnly(!readOnly),
      },
      {
        id: "overwrite",
        label: "Toggle insert/overwrite mode",
        run: () => setOverwrite(!overwrite),
      },
    ];
    useEffect(() => {
      const command = (event: Event) => {
        const detail = (
          event as CustomEvent<{ projectId: string; command: string }>
        ).detail;
        if (detail.projectId !== latest.current.projectId) return;
        if (detail.command === "commands") setPalette(true);
        else commandsRef.current.find((c) => c.id === detail.command)?.run();
      };
      window.addEventListener("alder-txt-command", command);
      return () => window.removeEventListener("alder-txt-command", command);
    }, []);
    return (
      <div
        className={
          "txt-editor editor-shell" + (props.pageLayout ? " txt-paged" : "")
        }
        style={
          props.pageLayout
            ? ({
                "--txt-paper-width": `${props.pageLayout.width * props.pageLayout.zoom}px`,
                "--txt-paper-height": `${props.pageLayout.height * props.pageLayout.zoom}px`,
                "--txt-paper-top": `${(props.pageLayout.margins?.top ?? props.pageLayout.margin) * props.pageLayout.zoom}px`,
                "--txt-paper-right": `${(props.pageLayout.margins?.right ?? props.pageLayout.margin) * props.pageLayout.zoom}px`,
                "--txt-paper-bottom": `${(props.pageLayout.margins?.bottom ?? props.pageLayout.margin) * props.pageLayout.zoom}px`,
                "--txt-paper-left": `${(props.pageLayout.margins?.left ?? props.pageLayout.margin) * props.pageLayout.zoom}px`,
                "--txt-paragraph-gap": `${12 * props.pageLayout.zoom}px`,
              } as CSSProperties)
            : undefined
        }
      >
        <WriteToolbar fileType="txt" displayTypography>
          <select
            aria-label="Text style"
            value="body"
            disabled
            title="TXT contains plain text"
          >
            <option value="body">Body</option>
          </select>
          <select
            aria-label="Font family"
            value={font}
            onChange={(e) => preferences.setFont(e.target.value)}
          >
            {fontCatalogue.families.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
          <FontSizeField
            value={String(Math.round(((fontSize * 72) / 96) * 10) / 10)}
            onApply={(size) => setFontSize((size * 96) / 72)}
          />
          <i />
          <button
            aria-label="Undo"
            title="Undo"
            onClick={() => run(historyCommand("undo"))}
          >
            <Undo2 />
          </button>
          <button
            aria-label="Redo"
            title="Redo"
            onClick={() => run(historyCommand("redo"))}
          >
            <Redo2 />
          </button>
          <button
            aria-label="Find and replace"
            title="Find and replace"
            onClick={() => props.onFind?.()}
          >
            <Search />
          </button>
          <i />
          <button
            aria-label="Line numbers"
            title="Line numbers"
            aria-pressed={numbers}
            onClick={() => setNumbers(!numbers)}
          >
            <ListOrdered />
          </button>
          <button
            aria-label="Word wrap"
            title="Word wrap"
            aria-pressed={wrap}
            onClick={() => setWrap(!wrap)}
          >
            <WrapText />
          </button>
          <button
            aria-label="Show whitespace"
            title="Show whitespace"
            aria-pressed={showWhitespace}
            disabled={!!props.suppressChecks}
            onClick={() => setWhitespace(!whitespace)}
          >
            <Pilcrow />
          </button>
          <span className="toolbar-spacer" />
          <button
            aria-label="Text tools"
            title="Text tools"
            aria-expanded={toolsOpen}
            onClick={() => setToolsOpen(!toolsOpen)}
          >
            <Ellipsis />
          </button>
        </WriteToolbar>
        <div
          className="txt-tools-popover"
          hidden={!toolsOpen}
          role="region"
          aria-label="Text tools"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setToolsOpen(false);
              e.currentTarget.parentElement
                ?.querySelector<HTMLButtonElement>(
                  'button[aria-label="Text tools"]',
                )
                ?.focus();
            }
          }}
        >
          <header>
            <strong>Text tools</strong>
            <button onClick={() => setToolsOpen(false)}>
              Close text tools
            </button>
          </header>
          <div className="txt-tools">
            <button
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("alder-txt-panel", {
                    detail: { projectId: props.projectId, panel: "file" },
                  }),
                );
                setToolsOpen(false);
              }}
            >
              File tools
            </button>
            <button
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("alder-txt-panel", {
                    detail: { projectId: props.projectId, panel: "folder" },
                  }),
                );
                setToolsOpen(false);
              }}
            >
              Folder workspace
            </button>
          </div>
          <div
            className="txt-tools"
            role="toolbar"
            aria-label="Text editor tools"
          >
            <button onClick={() => setPalette(true)}>Commands…</button>
            <label>
              <input
                type="checkbox"
                checked={overview === "true"}
                onChange={(e) => setOverview(String(e.target.checked))}
              />
              Document overview
            </label>
            <button onClick={() => setSplit((value) => !value)}>
              {split ? "Close second view" : "Split view"}
            </button>
            <label>
              <input
                type="checkbox"
                checked={synchronisedScroll}
                disabled={!split}
                onChange={(e) => setSynchronisedScroll(e.target.checked)}
              />
              Sync scrolling
            </label>
            <label>
              <input
                type="checkbox"
                checked={wrap}
                onChange={(e) => setWrap(e.target.checked)}
              />{" "}
              Wrap
            </label>
            <label>
              <input
                type="checkbox"
                checked={numbers}
                onChange={(e) => setNumbers(e.target.checked)}
              />{" "}
              Line numbers
            </label>
            <label>
              <input
                type="checkbox"
                checked={showWhitespace}
                disabled={!!props.suppressChecks}
                onChange={(e) => setWhitespace(e.target.checked)}
              />{" "}
              Whitespace
            </label>
            <label>
              Size{" "}
              <input
                aria-label="Text font size"
                type="number"
                min={8}
                max={48}
                value={fontSize}
                onChange={(e) =>
                  setFontSize(
                    Math.max(8, Math.min(48, Number(e.target.value) || 14)),
                  )
                }
              />
            </label>
            <label>
              Tab width{" "}
              <select
                value={tabSize}
                onChange={(e) => setTabSize(Number(e.target.value))}
              >
                {[2, 4, 8].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <button onClick={() => run(gotoLine)}>Go to line</button>
            <button onClick={() => run(startCompletion)}>Complete word</button>
            <select
              aria-label="Text syntax"
              value={syntax}
              onChange={(e) => setSyntax(e.target.value)}
            >
              <option value="plain">Plain text</option>
              <option value="json">JSON</option>
              <option value="log">Log</option>
            </select>
            <button
              onClick={() =>
                run((v) => {
                  const r = v.state.selection.main;
                  if (!r.empty)
                    v.dispatch({
                      effects: foldEffect.of({ from: r.from, to: r.to }),
                    });
                })
              }
            >
              Collapse selection
            </button>
            <button onClick={() => run(unfoldAll)}>Expand all</button>
            <button
              onClick={() =>
                run((v) =>
                  v.dispatch({
                    effects: toggleBookmark.of(v.state.selection.main.head),
                  }),
                )
              }
            >
              Toggle bookmark
            </button>
            <button onClick={() => run((v) => nextBookmark(v))}>
              Next bookmark
            </button>
            <select
              aria-label="Mark all occurrences"
              value=""
              onChange={(e) =>
                run((v) => {
                  if (e.target.value === "clear")
                    v.dispatch({ effects: clearMarks.of(null) });
                  else {
                    const r = v.state.selection.main,
                      query = v.state.sliceDoc(r.from, r.to);
                    if (!query) return;
                    const ranges = findText(v.state.doc.toString(), query, {
                      caseSensitive: preferences.caseSensitive,
                      wholeWord: preferences.wholeWord,
                    });
                    v.dispatch({
                      effects: markOccurrences.of({
                        ranges,
                        color: Number(e.target.value),
                      }),
                    });
                    setMessage(`Marked ${ranges.length} occurrences.`);
                  }
                })
              }
            >
              <option value="" disabled>
                Mark all occurrences…
              </option>
              {["Yellow", "Green", "Blue", "Pink"].map((name, i) => (
                <option key={i} value={i}>
                  {name}
                </option>
              ))}
              <option value="clear">Clear marks</option>
            </select>
            <select
              aria-label="Text operations"
              value=""
              onChange={(e) => {
                transform(e.target.value as TextOperation);
                setMessage("Text operation applied. Undo restores it.");
              }}
            >
              <option value="" disabled>
                Text operations…
              </option>
              {operations.map(([label, id]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label="Line operations"
              value=""
              onChange={(e) =>
                run(
                  {
                    duplicate: copyLineDown,
                    up: moveLineUp,
                    down: moveLineDown,
                    delete: deleteLine,
                    blank: insertBlankLine,
                    select: selectLine,
                  }[e.target.value as "duplicate"],
                )
              }
            >
              <option value="" disabled>
                Line operations…
              </option>
              <option value="duplicate">Duplicate line</option>
              <option value="up">Move line up</option>
              <option value="down">Move line down</option>
              <option value="delete">Delete line</option>
              <option value="blank">Insert blank line</option>
              <option value="select">Select line</option>
            </select>
          </div>
          <TextAutomationTools
            getView={() => view.current}
            recorder={macroRecorder}
            onMessage={setMessage}
          />
          <TextColumnTools
            getView={() => view.current}
            onMessage={setMessage}
          />
          <TextInsertionTools
            getView={() => view.current}
            onMessage={setMessage}
          />
          {!!view.current?.state.field(bookmarkField).length && (
            <details className="txt-issues">
              <summary>
                Bookmarked lines (
                {view.current.state.field(bookmarkField).length})
              </summary>
              <div>
                <button
                  onClick={() =>
                    run((v) => v.dispatch({ effects: clearBookmarks.of(null) }))
                  }
                >
                  Clear bookmarks
                </button>
                <button
                  onClick={() =>
                    run((v) => {
                      const text = v.state
                        .field(bookmarkField)
                        .map((at) => v.state.doc.lineAt(at).text)
                        .join("\n");
                      void copyText(text).then(
                        () => setMessage("Bookmarked lines copied."),
                        () => setMessage("Clipboard access is unavailable."),
                      );
                    })
                  }
                >
                  Copy bookmarked lines
                </button>
                <button
                  onClick={() =>
                    run((v) => {
                      if (v.state.readOnly) {
                        setMessage("Disable read-only mode to edit text.");
                        return;
                      }
                      const changes = v.state.field(bookmarkField).map((at) => {
                        const line = v.state.doc.lineAt(at);
                        return {
                          from: line.from,
                          to: Math.min(v.state.doc.length, line.to + 1),
                        };
                      });
                      v.dispatch({
                        changes,
                        effects: clearBookmarks.of(null),
                        userEvent: "input.bookmarks",
                      });
                    })
                  }
                >
                  Remove bookmarked lines
                </button>
              </div>
              {view.current.state
                .field(bookmarkField)
                .slice(0, 200)
                .map((at) => (
                  <button key={at} onClick={() => select(at)}>
                    {view.current!.state.doc.lineAt(at).number}:{" "}
                    {view.current!.state.doc.lineAt(at).text.slice(0, 100)}
                  </button>
                ))}
            </details>
          )}
          {writeChecks !== "false" &&
          !props.suppressChecks &&
          props.annotations?.length &&
          props.annotationText === view.current?.state.doc.toString() ? (
            <details className="txt-issues">
              <summary>
                Spelling &amp; grammar ({props.annotations.length})
              </summary>
              {props.annotations.slice(0, 50).map((a) => (
                <div key={a.id}>
                  <button onClick={() => select(a.start, a.end)}>
                    {a.message}
                  </button>
                  {a.alternatives?.map((alternative, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        try {
                          applyProofreading(
                            alternative.edits,
                            props.annotationText!,
                          );
                          setMessage("Correction applied.");
                        } catch (error) {
                          setMessage(String((error as Error).message));
                        }
                      }}
                    >
                      {alternative.label}
                    </button>
                  ))}
                </div>
              ))}
            </details>
          ) : null}
          <div className="txt-status" role="status">
            <span>{status || "TXT · Ready"}</span>
            <button
              onClick={() => setOverwrite((value) => !value)}
              title="Toggle insert/overwrite"
            >
              {overwrite ? "OVR" : "INS"}
            </button>
            <label>
              <input
                type="checkbox"
                checked={readOnly}
                onChange={(e) => setReadOnly(e.target.checked)}
              />
              Read-only
            </label>
            <label>
              Encoding{" "}
              <select
                aria-label="TXT encoding"
                disabled={readOnly}
                value={props.textFile?.encoding || "utf-8"}
                onChange={(e) =>
                  props.onTextFile?.({
                    ...props.textFile,
                    encoding: e.target.value,
                    bom:
                      e.target.value === "cp1252" ? false : props.textFile?.bom,
                  })
                }
              >
                <option value="utf-8">UTF-8</option>
                <option value="utf-16-le">UTF-16 LE</option>
                <option value="utf-16-be">UTF-16 BE</option>
                <option value="cp1252">Windows-1252</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                aria-label="TXT byte-order mark"
                disabled={readOnly || props.textFile?.encoding === "cp1252"}
                checked={props.textFile?.bom || false}
                onChange={(e) =>
                  props.onTextFile?.({
                    ...props.textFile,
                    bom: e.target.checked,
                  })
                }
              />{" "}
              BOM
            </label>
            <label>
              Line endings{" "}
              <select
                aria-label="TXT line endings"
                disabled={readOnly}
                value={
                  props.textFile?.convertEol
                    ? props.textFile.eol || "\n"
                    : "preserve"
                }
                onChange={(e) =>
                  props.onTextFile?.({
                    ...props.textFile,
                    eol:
                      e.target.value === "preserve"
                        ? props.textFile?.eol || "\n"
                        : e.target.value,
                    convertEol: e.target.value !== "preserve",
                  })
                }
              >
                <option value="preserve">
                  Preserve
                  {Array.isArray(props.textFile?.endings) &&
                  new Set(props.textFile.endings).size > 1
                    ? " mixed endings"
                    : ""}
                </option>
                <option value={"\n"}>LF</option>
                <option value={"\r\n"}>CRLF</option>
                <option value={"\r"}>CR</option>
              </select>
            </label>
            {message && <span>{message}</span>}
          </div>
        </div>
        <div className="txt-editor-views">
          <div ref={host} className="txt-host" />
          {split && (
            <div ref={secondaryHost} className="txt-host txt-secondary-host" />
          )}
          {overview === "true" && (
            <TextOverview
              view={view.current}
              annotations={props.annotations || []}
            />
          )}
        </div>
        {palette && (
          <TextCommandPalette
            commands={commandsRef.current}
            value={shortcutMap}
            onChange={setShortcutMap}
            onClose={() => setPalette(false)}
          />
        )}
      </div>
    );
  },
);
