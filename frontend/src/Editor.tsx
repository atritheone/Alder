import { speechText, type SpeechText } from "./speechText";
import { useStoredPreference } from "./useStoredPreference";
import {
  proofreadingTransaction,
  type ProofreadingEdit,
} from "./proofreadingEdits";
import {
  changeCase,
  caseInputPlugin,
  type CaseMode,
  type LetterCase,
} from "./caseTransform";
import { openContextMenu, editCommand } from "./ContextMenu";
import { spacedWord } from "./wordInsertion";
import { persistentCaret } from "./persistentCaret";
import { readingHighlight } from "./readingHighlight";
import { structureMarks } from "./structureMarks";
import { useFontCatalogue } from "./useInstalledFonts";
import { shortcutLabel } from "./platform";
import {
  DOCUMENT_FONT,
  fontIsAvailable,
  loadDocumentFont,
} from "./fontCatalogue";
import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useRef,
  useState,
  useMemo,
  useId,
  type ReactNode,
} from "react";
import {
  Schema,
  Node as PMNode,
  DOMParser,
  Fragment,
  Slice,
} from "prosemirror-model";
import {
  AllSelection,
  EditorState,
  Plugin,
  TextSelection,
} from "prosemirror-state";
import { EditorView, Decoration, DecorationSet } from "prosemirror-view";
import {
  baseKeymap,
  toggleMark,
  setBlockType,
  wrapIn,
  chainCommands,
  exitCode,
} from "prosemirror-commands";
import { history, undo, redo, closeHistory } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import {
  addListNodes,
  wrapInList,
  splitListItem,
  sinkListItem,
  liftListItem,
} from "prosemirror-schema-list";
import {
  tableNodes,
  columnResizing,
  tableEditing,
  addRowAfter,
  addColumnAfter,
  deleteTable,
} from "prosemirror-tables";
import { dropCursor } from "prosemirror-dropcursor";
import {
  paginatePages,
  pageAtPosition,
  rearrangePages,
  PAGE_GAP,
  type FlowPage,
  type PageLayout,
} from "./pageFlow";
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Quote,
  ImagePlus,
  Table2,
  Link,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Undo2,
  Redo2,
  WrapText,
  Pilcrow,
  SpellCheck,
} from "lucide-react";
import type { Annotation, DocNode, Idea, Project, StyleKind } from "./types";
import { mediaUrl } from "./api";
import { projectText, projectedRange } from "./textProjection";
import { styleDeclarations, styleSheet } from "./styleResolution";
import { pageSnapshots } from "./pageSnapshots";
import { moveArrangementUnit, type ArrangementUnit } from "./arrangementUnits";

const attrs = {
  align: { default: null },
  styleId: { default: null },
  fontFamily: { default: null },
  fontSize: { default: null },
  lineHeight: { default: null },
  spaceAfter: { default: null },
  color: { default: null },
  leftIndent: { default: null },
  firstLineIndent: { default: null },
  indent: { default: null },
};
const points = (value: string) =>
  value ? parseFloat(value) * (value.endsWith("px") ? 0.75 : 1) : null;
const blockDOMAttrs = (dom: HTMLElement) => ({
  styleId: dom.getAttribute("data-style"),
  align: dom.style.textAlign || null,
  fontFamily: dom.style.fontFamily || null,
  fontSize: points(dom.style.fontSize),
  lineHeight: /^\d+(?:\.\d+)?$/.test(dom.style.lineHeight)
    ? Number(dom.style.lineHeight)
    : null,
  spaceAfter: points(dom.style.marginBottom),
  color: dom.style.color || null,
  leftIndent: points(dom.style.marginLeft),
  firstLineIndent: points(dom.style.textIndent),
});
const blockDOM = (attributes: Record<string, any>) => ({
  "data-style": attributes.styleId,
  style:
    styleDeclarations({
      ...attributes,
      firstLineIndent: attributes.firstLineIndent ?? attributes.indent,
    }) || null,
});
const baseSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      attrs,
      parseDOM: [{ tag: "p", getAttrs: blockDOMAttrs }],
      toDOM: (n) => ["p", blockDOM(n.attrs), 0],
    },
    text: { group: "inline" },
    heading: {
      attrs: { ...attrs, level: { default: 1 } },
      content: "inline*",
      group: "block",
      defining: true,
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
        tag: `h${level}`,
        getAttrs: (dom) => ({ ...blockDOMAttrs(dom), level }),
      })),
      toDOM: (n) => ["h" + n.attrs.level, blockDOM(n.attrs), 0],
    },
    blockquote: {
      content: "block+",
      group: "block",
      defining: true,
      parseDOM: [{ tag: "blockquote" }],
      toDOM: () => ["blockquote", 0],
    },
    code_block: {
      attrs,
      content: "text*",
      marks: "",
      group: "block",
      code: true,
      defining: true,
      parseDOM: [
        { tag: "pre", preserveWhitespace: "full", getAttrs: blockDOMAttrs },
      ],
      toDOM: (n) => ["pre", blockDOM(n.attrs), ["code", 0]],
    },
    hard_break: {
      inline: true,
      group: "inline",
      selectable: false,
      parseDOM: [{ tag: "br" }],
      toDOM: () => ["br"],
    },
    horizontal_rule: {
      group: "block",
      parseDOM: [{ tag: "hr" }],
      toDOM: () => ["hr"],
    },
    page_break: {
      group: "block",
      atom: true,
      toDOM: () => [
        "div",
        { class: "page-break", "aria-label": "Page break" },
        "Page break",
      ],
      parseDOM: [{ tag: "div.page-break" }],
    },
    image: {
      inline: false,
      group: "block",
      draggable: true,
      attrs: {
        src: { default: "" },
        assetId: { default: null },
        alt: { default: "" },
        title: { default: null },
        width: { default: null },
      },
      parseDOM: [
        {
          tag: "img[src]",
          getAttrs: (dom) => ({
            src: dom.getAttribute("src"),
            alt: dom.getAttribute("alt") || "",
            title: dom.getAttribute("title"),
            width: dom.getAttribute("width"),
            assetId: dom.getAttribute("data-asset-id"),
          }),
        },
      ],
      toDOM: (n) => [
        "figure",
        {},
        [
          "img",
          {
            src: n.attrs.src?.startsWith("/api/")
              ? mediaUrl(n.attrs.src)
              : n.attrs.src,
            alt: n.attrs.alt,
            title: n.attrs.title,
            width: n.attrs.width,
            "data-asset-id": n.attrs.assetId,
          },
        ],
      ],
    },
  },
  marks: {
    strong: {
      parseDOM: [{ tag: "strong" }, { tag: "b" }],
      toDOM: () => ["strong", 0],
    },
    em: { parseDOM: [{ tag: "i" }, { tag: "em" }], toDOM: () => ["em", 0] },
    underline: { parseDOM: [{ tag: "u" }], toDOM: () => ["u", 0] },
    code: { parseDOM: [{ tag: "code" }], toDOM: () => ["code", 0] },
    link: {
      attrs: { href: {} },
      inclusive: false,
      parseDOM: [
        {
          tag: "a[href]",
          getAttrs: (dom) => ({ href: dom.getAttribute("href") }),
        },
      ],
      toDOM: (n) => [
        "a",
        { href: n.attrs.href, rel: "noopener noreferrer" },
        0,
      ],
    },
    text_style: {
      attrs: {
        styleId: { default: null },
        fontFamily: { default: null },
        fontSize: { default: null },
        color: { default: null },
      },
      parseDOM: [
        {
          tag: "span[style],span[data-style]",
          getAttrs: (dom) => ({
            styleId: dom.getAttribute("data-style"),
            fontFamily: dom.style.fontFamily || null,
            fontSize: points(dom.style.fontSize),
            color: dom.style.color || null,
          }),
        },
      ],
      toDOM: (n) => [
        "span",
        {
          "data-style": n.attrs.styleId,
          style: styleDeclarations(n.attrs, "character"),
        },
        0,
      ],
    },
  },
});
let nodes = baseSchema.spec.nodes;
nodes = addListNodes(nodes, "paragraph block*", "block").append(
  tableNodes({
    tableGroup: "block",
    cellContent: "block+",
    cellAttributes: {},
  }),
);
export const schema = new Schema({
  nodes,
  marks: baseSchema.spec.marks!.append({
    strike: {
      parseDOM: [{ tag: "s" }, { tag: "del" }, { tag: "strike" }],
      toDOM: () => ["s", 0],
    },
    subscript: { parseDOM: [{ tag: "sub" }], toDOM: () => ["sub", 0] },
    superscript: { parseDOM: [{ tag: "sup" }], toDOM: () => ["sup", 0] },
    highlight: {
      attrs: { color: { default: "#f0dc8a" } },
      parseDOM: [
        {
          tag: "mark",
          getAttrs: (dom) => ({
            color: dom.style.backgroundColor || "#f0dc8a",
          }),
        },
      ],
      toDOM: (n) => ["mark", { style: "background:" + n.attrs.color }, 0],
    },
  }),
});

function normaliseDoc(input: DocNode): any {
  const aliases: Record<string, string> = {
    bulletList: "bullet_list",
    orderedList: "ordered_list",
    listItem: "list_item",
    hardBreak: "hard_break",
    codeBlock: "code_block",
    horizontalRule: "horizontal_rule",
    tableRow: "table_row",
    tableCell: "table_cell",
    tableHeader: "table_header",
    pageBreak: "page_break",
  };
  const marks: Record<string, string> = {
    bold: "strong",
    italic: "em",
    textStyle: "text_style",
    s: "strike",
    sub: "subscript",
    sup: "superscript",
  };
  return {
    ...input,
    type: aliases[input.type] || input.type,
    marks: input.marks?.map((m) => ({ ...m, type: marks[m.type] || m.type })),
    content: input.content?.map(normaliseDoc),
  };
}
export function parseEditorDocument(input: DocNode): {
  document: PMNode | null;
  error: string | null;
} {
  try {
    const normalised = normaliseDoc(input);
    const validateAttributes = (node: DocNode) => {
      const supported = schema.nodes[node.type]?.spec.attrs || {};
      for (const key of Object.keys(node.attrs || {})) {
        if (!(key in supported))
          throw new Error(`Unsupported ${node.type} attribute: ${key}`);
      }
      for (const mark of node.marks || []) {
        const supportedMark = schema.marks[mark.type]?.spec.attrs || {};
        for (const key of Object.keys(mark.attrs || {})) {
          if (!(key in supportedMark))
            throw new Error(`Unsupported ${mark.type} attribute: ${key}`);
        }
      }
      node.content?.forEach(validateAttributes);
    };
    validateAttributes(normalised);
    const document = schema.nodeFromJSON(normalised);
    document.check();
    return { document, error: null };
  } catch {
    return {
      document: null,
      error:
        "This draft contains a structure Alder cannot edit yet. The original source is preserved and can be exported.",
    };
  }
}
export function namedStyleTransaction(
  state: EditorState,
  id: string,
  kind: StyleKind = "paragraph",
) {
  const tr = state.tr,
    { from, to, empty } = state.selection;
  if (kind === "paragraph") {
    state.doc.nodesBetween(from, to, (node, position) => {
      if (node.isTextblock)
        tr.setNodeMarkup(position, undefined, {
          ...node.attrs,
          styleId: id || null,
        });
    });
  } else {
    const type = schema.marks.text_style;
    const attributes = (
      marks: readonly import("prosemirror-model").Mark[],
    ) => ({ ...type.isInSet(marks)?.attrs, styleId: id || null });
    const hasValues = (values: Record<string, unknown>) =>
      Object.values(values).some(
        (value) => value !== undefined && value !== null && value !== "",
      );
    if (empty) {
      const values = attributes(
        state.storedMarks || state.selection.$from.marks(),
      );
      if (hasValues(values)) tr.addStoredMark(type.create(values));
      else tr.removeStoredMark(type);
    } else
      state.doc.nodesBetween(from, to, (node, position) => {
        if (!node.isInline) return;
        const values = attributes(node.marks),
          start = Math.max(from, position),
          end = Math.min(to, position + node.nodeSize);
        if (start >= end) return;
        if (hasValues(values)) tr.addMark(start, end, type.create(values));
        else tr.removeMark(start, end, type);
      });
  }
  return tr;
}
export type EditorHandle = {
  getDocumentPosition: () => { top: number; left: number; offset: number };
  restoreDocumentPosition: (position: {
    top: number;
    left: number;
    offset: number;
  }) => void;
  getSpeechText: (
    start: number,
    end: number,
    readReferences: boolean,
  ) => SpeechText;
  setReadingRange: (range: { start: number; end: number } | null) => void;
  pageAtTextOffset: (offset: number) => number | null;
  moveUnit: (unit: ArrangementUnit, destination: number) => void;
  getText: () => string;
  replaceAll: (find: string, replacement: string) => void;
  getSelectionOffsets: () => { start: number; end: number };
  insertDocument: (document: DocNode) => void;
  navigatePage: (page: number) => void;
  movePage: (from: number, to: number) => void;
  insert: (text: string) => void;
  replace: (text: string) => void;
  replaceRange: (start: number, end: number, text: string) => void;
  applyProofreading: (edits: ProofreadingEdit[], expectedText: string) => void;
  selectRange: (start: number, end: number) => void;
  image: (src: string, assetId: string, alt: string) => void;
  link: (text: string, url: string) => void;
  style: (id: string, kind?: StyleKind) => void;
  focus: () => void;
  getSelection: () => string;
};
type Props = {
  label?: string;
  toolbarContent?: ReactNode;
  onToggleSpeech?: () => void;
  rawMode?: boolean;
  onToggleRaw?: () => void;
  rawDisabled?: boolean;
  pageLayout?: PageLayout;
  layoutVisible?: boolean;
  capturePages?: boolean;
  onPageSnapshots?: (pages: string[]) => void;
  persistentCaret?: boolean;
  onPages?: (pages: FlowPage[]) => void;
  onVisiblePage?: (page: number) => void;
  onFocus?: () => void;
  readingRange?: { start: number; end: number } | null;
  document: DocNode;
  identity: string;
  onChange: (document: DocNode, text: string) => void;
  onSelection: (
    word: string,
    selection: string,
    range?: { from: number; to: number },
  ) => void;
  annotations?: Annotation[];
  annotationText?: string;
  suppressChecks?: boolean;
  caseScope?: "selection" | "document";
  showStructure: boolean;
  onToggleStructure: () => void;
  onImage: () => void;
  onLink: () => void;
  onComplete?: () => void;
  onHistory?: (type: "undo" | "redo") => void;
  fontFamily?: string;
  fontSize?: number;
  styles?: Project["styles"];
};
/** Decoration refreshes must not overwrite a native cursor move that arrived
 * before ProseMirror's asynchronous selectionchange observer. */
function refreshEditorDecorations(v: EditorView) {
  const live = v.dom.ownerDocument.getSelection();
  if (
    v.hasFocus() &&
    live?.anchorNode &&
    live.focusNode &&
    v.dom.contains(live.anchorNode) &&
    v.dom.contains(live.focusNode) &&
    v.state.selection instanceof TextSelection
  ) {
    try {
      const selection = TextSelection.between(
        v.state.doc.resolve(v.posAtDOM(live.anchorNode, live.anchorOffset)),
        v.state.doc.resolve(v.posAtDOM(live.focusNode, live.focusOffset)),
      );
      if (!selection.eq(v.state.selection)) {
        v.dispatch(v.state.tr.setSelection(selection));
        return;
      }
    } catch {
      /* A pending DOM edit is reconciled by ProseMirror's observer. */
    }
  }
  v.updateState(v.state);
}

export default forwardRef<EditorHandle, Props>(function Editor(props, ref) {
  const editorScope = useId();
  const directReadingRange = useRef<
    { start: number; end: number } | null | undefined
  >(undefined);
  const [caseMode, setCaseMode] = useState<CaseMode>("free");
  const inputCase = useRef<CaseMode>("free");
  inputCase.current = caseMode;
  const spellcheckKey =
    props.caseScope === "document"
      ? "alder.sandboxSpellcheck"
      : "alder.writeSpellcheck";
  const [spellcheckValue, setSpellcheck] = useStoredPreference(
    spellcheckKey,
    "true",
  );
  const spellcheck = spellcheckValue !== "false";
  const visibleAnnotations = useMemo(
    () => (spellcheck && !props.suppressChecks ? props.annotations || [] : []),
    [props.annotations, spellcheck, props.suppressChecks],
  );
  const namedStyles = useMemo(() => {
    try {
      return { css: styleSheet(props.styles || [], editorScope), error: "" };
    } catch (error) {
      return { css: "", error: (error as Error).message };
    }
  }, [props.styles, editorScope]);
  const host = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    latest = useRef(props),
    lastJSON = useRef("");
  const selection = useRef<{ from: number; to: number; text: string } | null>(
      null,
    ),
    decos = useRef<Annotation[]>([]),
    annotationSource = useRef<string | null>(null),
    blocked = useRef(false);
  const [parseError, setParseError] = useState<string | null>(null),
    [rangeWarning, setRangeWarning] = useState("");
  const [, tick] = useState(0);
  const [documentVersion, documentTick] = useState(0);
  const pageDecorations = useRef(DecorationSet.empty);
  const measuredPages = useRef<FlowPage[]>([]);
  const lastPageMeasurement = useRef<{ doc: PMNode; key: string } | null>(null);
  const [flowPages, setFlowPages] = useState<FlowPage[]>([]);
  const [pageInset, setPageInset] = useState(0);
  const selectedTextStyle = (state: EditorState) => {
    let marks = state.storedMarks || state.selection.$from.marks();
    if (!state.selection.empty) {
      let found = false;
      state.doc.nodesBetween(
        state.selection.from,
        state.selection.to,
        (node) => {
          if (found) return false;
          if (node.isText) {
            marks = node.marks;
            found = true;
          }
        },
      );
    }
    return schema.marks.text_style.isInSet(marks)?.attrs || {};
  };
  const currentFont =
    (view.current && selectedTextStyle(view.current.state).fontFamily) ||
    props.fontFamily ||
    DOCUMENT_FONT;
  const fontCatalogue = useFontCatalogue(currentFont);
  const installedFonts = fontCatalogue.families;
  useEffect(() => {
    if (!fontCatalogue.catalogue) return;
    const families = new Set<string>([props.fontFamily || DOCUMENT_FONT]);
    for (const style of props.styles || [])
      if (style.fontFamily) families.add(style.fontFamily);
    const visit = (node: DocNode) => {
      if (node.attrs?.fontFamily) families.add(String(node.attrs.fontFamily));
      for (const mark of node.marks || [])
        if (mark.attrs?.fontFamily) families.add(String(mark.attrs.fontFamily));
      for (const child of node.content || []) visit(child);
    };
    visit(props.document);
    for (const family of families)
      if (!fontIsAvailable(family, fontCatalogue.catalogue))
        void loadDocumentFont(family).catch(() => {});
  }, [props.document, props.styles, props.fontFamily, fontCatalogue.catalogue]);
  latest.current = props;
  decos.current = visibleAnnotations;
  const command = (cmd: any) => {
    if (view.current && !blocked.current) {
      cmd(view.current.state, view.current.dispatch, view.current);
      view.current.focus();
    }
  };
  const editableView = () => (blocked.current ? null : view.current);
  const selectionRange = (v: EditorView) => {
    const span = selection.current || v.state.selection;
    if (
      span.from < 0 ||
      span.to < span.from ||
      span.to > v.state.doc.content.size ||
      (selection.current &&
        v.state.doc.textBetween(span.from, span.to, "\n") !==
          selection.current.text)
    ) {
      setRangeWarning(
        "The selected wording has changed. Select it again before replacing it.",
      );
      return null;
    }
    return span;
  };
  const textRange = (v: EditorView, start: number, end: number) => {
    try {
      const projection = projectText(v.state.doc);
      if (
        decos.current.some((a) => a.start === start && a.end === end) &&
        annotationSource.current !== projection.text
      )
        throw new RangeError(
          "This result refers to earlier text. Run the check again.",
        );
      return projectedRange(v.state.doc, start, end, undefined, projection);
    } catch (error) {
      setRangeWarning((error as Error).message);
      return null;
    }
  };
  useImperativeHandle(
    ref,
    () => ({
      getDocumentPosition() {
        const v = view.current;
        const viewport = v?.dom.closest<HTMLElement>(".editor-scroll");
        const map = v ? projectText(v.state.doc).map : [];
        const live = v?.dom.ownerDocument.getSelection();
        const caret =
          v && live?.focusNode && v.dom.contains(live.focusNode)
            ? v.posAtDOM(live.focusNode, live.focusOffset)
            : v?.state.selection.from || 0;
        let low = 0,
          high = map.length;
        while (low < high) {
          const mid = (low + high) >>> 1;
          if (map[mid] < caret) low = mid + 1;
          else high = mid;
        }
        return {
          top: viewport?.scrollTop || 0,
          left: viewport?.scrollLeft || 0,
          offset: Math.min(low, Math.max(0, map.length - 1)),
        };
      },
      restoreDocumentPosition(position) {
        const v = view.current;
        if (!v) return;
        const projection = projectText(v.state.doc);
        const offset = Math.min(projection.text.length, position.offset);
        v.dispatch(
          v.state.tr.setSelection(
            TextSelection.near(v.state.doc.resolve(projection.map[offset])),
          ),
        );
        const viewport = v.dom.closest<HTMLElement>(".editor-scroll");
        viewport?.scrollTo({
          top: position.top,
          left: position.left,
          behavior: "instant",
        });
      },
      getSpeechText(start, end, readReferences) {
        return view.current
          ? speechText(view.current.state.doc, start, end, readReferences)
          : { text: "", offsets: [0], endOffsets: [0] };
      },
      setReadingRange(range) {
        directReadingRange.current = range;
        if (view.current) view.current.updateState(view.current.state);
      },
      replaceAll(find, replacement) {
        const v = editableView();
        if (!v || !find) return;
        const projection = projectText(v.state.doc),
          matches: { from: number; to: number }[] = [];
        for (
          let start = projection.text.indexOf(find);
          start >= 0;
          start = projection.text.indexOf(find, start + find.length)
        )
          matches.push(
            projectedRange(
              v.state.doc,
              start,
              start + find.length,
              undefined,
              projection,
            ),
          );
        const tr = v.state.tr;
        for (const span of matches.reverse())
          tr.insertText(replacement, span.from, span.to);
        if (matches.length) v.dispatch(tr);
      },
      getSelectionOffsets() {
        const v = editableView();
        if (!v) return { start: 0, end: 0 };
        const { map, text } = projectText(v.state.doc);
        const offset = (position: number) => {
          let low = 0,
            high = map.length;
          while (low < high) {
            const middle = (low + high) >>> 1;
            if (map[middle] < position) low = middle + 1;
            else high = middle;
          }
          return Math.min(low, text.length);
        };
        // Native cursor movement can precede ProseMirror's selectionchange
        // observer. Read the live caret before a toolbar action takes focus.
        const live = v.dom.ownerDocument.getSelection();
        if (
          live?.anchorNode &&
          live.focusNode &&
          v.dom.contains(live.anchorNode) &&
          v.dom.contains(live.focusNode)
        ) {
          const anchor = v.posAtDOM(live.anchorNode, live.anchorOffset);
          const focus = v.posAtDOM(live.focusNode, live.focusOffset);
          return {
            start: offset(Math.min(anchor, focus)),
            end: offset(Math.max(anchor, focus)),
          };
        }
        return {
          start: offset(v.state.selection.from),
          end: offset(v.state.selection.to),
        };
      },
      getText() {
        return view.current ? projectText(view.current.state.doc).text : "";
      },
      pageAtTextOffset(offset) {
        const v = view.current;
        if (!v) return null;
        try {
          const { from } = projectedRange(v.state.doc, offset, offset);
          return pageAtPosition(measuredPages.current, from);
        } catch {
          return null;
        }
      },
      insertDocument(document) {
        const v = editableView();
        const parsed = parseEditorDocument(document);
        if (!v || !parsed.document) return;
        v.dispatch(
          v.state.tr
            .replaceSelection(new Slice(parsed.document.content, 0, 0))
            .scrollIntoView(),
        );
        v.focus();
      },
      navigatePage(page) {
        const v = editableView(),
          layout = latest.current.pageLayout;
        if (!v || !layout) return;
        const pages = measuredPages.current,
          target = pages[page];
        if (!target) return;
        v.dispatch(
          v.state.tr.setSelection(
            TextSelection.near(v.state.doc.resolve(target.from)),
          ),
        );
        const scroll = host.current?.closest(".editor-scroll");
        scroll?.scrollTo({
          top: page * (layout.height + PAGE_GAP) * layout.zoom,
          behavior: "smooth",
        });
      },
      movePage(from, to) {
        const v = editableView(),
          layout = latest.current.pageLayout;
        if (!v || !layout) return;
        try {
          const next = rearrangePages(
            v.state.doc,
            measuredPages.current,
            from,
            to,
          );
          if (next !== v.state.doc)
            v.dispatch(
              v.state.tr.replaceWith(0, v.state.doc.content.size, next.content),
            );
        } catch (e) {
          setRangeWarning((e as Error).message);
        }
      },
      moveUnit(unit, destination) {
        const v = editableView();
        if (!v) return;
        try {
          const move = moveArrangementUnit(v.state, unit, destination);
          if (move) {
            v.dispatch(closeHistory(move.tr));
            v.dispatch(closeHistory(v.state.tr));
          }
        } catch (error) {
          setRangeWarning((error as Error).message);
        }
      },
      insert(text) {
        const v = editableView();
        if (!v) return;
        v.dispatch(v.state.tr.insertText(text));
        v.focus();
      },
      replace(text) {
        const v = editableView();
        if (!v) return;
        const span = selectionRange(v);
        if (!span) return;
        v.dispatch(v.state.tr.insertText(text, span.from, span.to));
        v.focus();
      },
      replaceRange(start, end, text) {
        const v = editableView();
        if (!v) return;
        const span = textRange(v, start, end);
        if (!span) return;
        v.dispatch(v.state.tr.insertText(text, span.from, span.to));
        v.focus();
      },
      applyProofreading(edits, expectedText) {
        const v = editableView();
        if (!v) throw new Error("The editor is not available for corrections.");
        v.dispatch(proofreadingTransaction(v.state, expectedText, edits));
        v.dispatch(closeHistory(v.state.tr));
        v.focus();
      },
      selectRange(start, end) {
        const v = editableView();
        if (!v) return;
        const span = textRange(v, start, end);
        if (!span) return;
        v.dispatch(
          v.state.tr.setSelection(
            TextSelection.create(v.state.doc, span.from, span.to),
          ),
        );
        v.focus();
      },
      image(src, assetId, alt) {
        const v = editableView();
        if (!v) return;
        v.dispatch(
          v.state.tr.replaceSelectionWith(
            schema.nodes.image.create({ src, assetId, alt }),
          ),
        );
        v.focus();
      },
      link(text, url) {
        const v = editableView();
        if (!v) return;
        const span = selectionRange(v);
        if (!span) return;
        v.dispatch(
          v.state.tr.replaceWith(
            span.from,
            span.to,
            schema.text(text, [schema.marks.link.create({ href: url })]),
          ),
        );
        v.focus();
      },
      style(id, kind) {
        const v = editableView();
        if (!v) return;
        const style = latest.current.styles?.find((style) => style.id === id);
        if (id && !style) {
          setRangeWarning(
            "This style is no longer available. Choose a current project style.",
          );
          return;
        }
        v.dispatch(
          namedStyleTransaction(
            v.state,
            id,
            kind || style?.kind || "paragraph",
          ),
        );
        v.focus();
      },
      focus() {
        view.current?.focus();
      },
      getSelection() {
        const v = editableView();
        return v
          ? v.state.doc.textBetween(
              v.state.selection.from,
              v.state.selection.to,
              "\n",
            )
          : "";
      },
    }),
    [],
  );
  useLayoutEffect(() => {
    if (!host.current) return;
    const parsed = parseEditorDocument(props.document);
    blocked.current = !parsed.document;
    setParseError(parsed.error);
    setRangeWarning("");
    selection.current = null;
    annotationSource.current = null;
    latest.current.onSelection("", "");
    const doc =
      parsed.document || schema.node("doc", null, [schema.node("paragraph")]);
    lastJSON.current = JSON.stringify(props.document);
    pageDecorations.current = DecorationSet.empty;
    measuredPages.current = [];
    let annotationsCache: {
      doc: PMNode;
      annotations: Annotation[];
      source: string | null;
      decorations: DecorationSet;
    } | null = null;
    const v = new EditorView(host.current, {
      state: EditorState.create({
        doc,
        plugins: [
          caseInputPlugin(
            () => inputCase.current,
            () => view.current?.composing || false,
          ),
          new Plugin({ props: { decorations: () => pageDecorations.current } }),
          structureMarks(
            () => latest.current.showStructure && !blocked.current,
          ),
          ...(props.persistentCaret && !blocked.current
            ? [persistentCaret()]
            : []),
          history(),
          keymap({
            "Mod-Enter": () => {
              if (!latest.current.onToggleSpeech) return false;
              latest.current.onToggleSpeech();
              return true;
            },
            "Ctrl-Space": () => {
              latest.current.onComplete?.();
              return true;
            },
            "Mod-z": undo,
            "Mod-y": redo,
            "Mod-Shift-z": redo,
            "Mod-b": props.rawMode
              ? () => true
              : toggleMark(schema.marks.strong),
            "Mod-i": props.rawMode ? () => true : toggleMark(schema.marks.em),
            "Mod-u": props.rawMode
              ? () => true
              : toggleMark(schema.marks.underline),
            Enter: splitListItem(schema.nodes.list_item),
            Tab: props.rawMode
              ? (state, dispatch) => {
                  dispatch?.(state.tr.insertText("\t"));
                  return true;
                }
              : chainCommands(
                  sinkListItem(schema.nodes.list_item),
                  (state, dispatch) => {
                    dispatch?.(state.tr.insertText("\t"));
                    return true;
                  },
                ),
            "Shift-Tab": liftListItem(schema.nodes.list_item),
            "Shift-Enter": props.rawMode
              ? baseKeymap.Enter
              : chainCommands(exitCode, (state, dispatch) => {
                  dispatch?.(
                    state.tr.replaceSelectionWith(
                      schema.nodes.hard_break.create(),
                    ),
                  );
                  return true;
                }),
          }),
          keymap(baseKeymap),
          columnResizing(),
          tableEditing(),
          dropCursor(),
          readingHighlight(
            () =>
              blocked.current
                ? null
                : directReadingRange.current === undefined
                  ? latest.current.readingRange
                  : directReadingRange.current,
            () => latest.current.layoutVisible !== false,
          ),
          new Plugin({
            props: {
              handleClick(_view, _position, event) {
                const target = (event.target as HTMLElement)?.closest(
                  "[data-proofreading-id]",
                );
                if (!target) return false;
                window.dispatchEvent(
                  new CustomEvent("alder-proofreading-select", {
                    detail: target.getAttribute("data-proofreading-id"),
                  }),
                );
                return false;
              },
              decorations(state) {
                if (blocked.current) return DecorationSet.empty;
                if (
                  annotationsCache?.doc === state.doc &&
                  annotationsCache.annotations === decos.current &&
                  annotationsCache.source === annotationSource.current
                )
                  return annotationsCache.decorations;
                const projection = projectText(state.doc);
                if (annotationSource.current !== projection.text)
                  return DecorationSet.empty;
                const spans: Decoration[] = [];
                for (const annotation of decos.current) {
                  try {
                    const { from, to } = projectedRange(
                      state.doc,
                      annotation.start,
                      annotation.end,
                      undefined,
                      projection,
                    );
                    if (to > from)
                      spans.push(
                        Decoration.inline(from, to, {
                          class: `annotation annotation-${annotation.type}${annotation.type === "spelling" ? "" : " annotation-grammar"}`,
                          "data-help": `${annotation.type}: ${annotation.message}`,
                          "data-proofreading-id": annotation.id,
                        }),
                      );
                    else if (annotation.alternatives?.length) {
                      spans.push(
                        Decoration.widget(
                          from,
                          () => {
                            const marker = document.createElement("span");
                            marker.className = "annotation-insertion";
                            marker.textContent = "⌃";
                            marker.setAttribute("role", "note");
                            marker.setAttribute(
                              "aria-label",
                              annotation.message,
                            );
                            marker.setAttribute(
                              "data-help",
                              annotation.message,
                            );
                            marker.setAttribute(
                              "data-proofreading-id",
                              annotation.id,
                            );
                            return marker;
                          },
                          { key: annotation.id, side: -1 },
                        ),
                      );
                    }
                  } catch {
                    /* An outdated annotation must never address arbitrary editor positions. */
                  }
                }
                const decorations = DecorationSet.create(state.doc, spans);
                annotationsCache = {
                  doc: state.doc,
                  annotations: decos.current,
                  source: annotationSource.current,
                  decorations,
                };
                return decorations;
              },
            },
          }),
        ],
      }),
      editable: () => !blocked.current,
      attributes: {
        role: "textbox",
        "aria-label": props.label || "Sandbox text editor",
        "aria-multiline": "true",
        spellcheck: "false",
      },
      dispatchTransaction(tr) {
        if (blocked.current && tr.docChanged) return;
        const applied = v.state.applyTransaction(tr);
        const next = applied.state;
        const docChanged = applied.transactions.some(
          (transaction) => transaction.docChanged,
        );
        if (docChanged) {
          annotationSource.current = null;
          for (const transaction of applied.transactions)
            pageDecorations.current = pageDecorations.current.map(
              transaction.mapping,
              transaction.doc,
            );
        }
        v.updateState(next);
        if (docChanged) {
          documentTick((n) => n + 1);
          setRangeWarning("");
          const json = next.doc.toJSON();
          lastJSON.current = JSON.stringify(json);
          latest.current.onChange(json, projectText(next.doc).text);
        }
        const s = next.selection;
        const selected = next.doc.textBetween(s.from, s.to, "\n");
        let word = selected.trim();
        selection.current = null;
        if (s.empty && s.$from.parent.isTextblock) {
          const start = s.$from.start(),
            parent = s.$from.parent.textContent,
            at = s.from - start;
          const left =
              parent.slice(0, at).match(/[\p{L}\p{N}â€™'-]+$/u)?.[0] || "",
            right = parent.slice(at).match(/^[\p{L}\p{N}â€™'-]+/u)?.[0] || "";
          word = left + right;
          if (word)
            selection.current = {
              from: s.from - left.length,
              to: s.from + right.length,
              text: word,
            };
        } else if (!s.empty)
          selection.current = { from: s.from, to: s.to, text: selected };
        latest.current.onSelection(word, selected, { from: s.from, to: s.to });
        if (tr.selectionSet || docChanged)
          window.dispatchEvent(new Event("alder-proofreading-caret"));
        tick((n) => n + 1);
      },
      handlePaste(v, event) {
        if (!latest.current.rawMode) return false;
        const text = event.clipboardData?.getData("text/plain");
        if (text === undefined) return false;
        refreshEditorDecorations(v);
        const doc = schema.nodeFromJSON({
          type: "doc",
          content: text.split(/\r?\n/).map((line) => ({
            type: "paragraph",
            content: line ? [{ type: "text", text: line }] : [],
          })),
        });
        v.dispatch(v.state.tr.replaceSelection(Slice.maxOpen(doc.content)));
        return true;
      },
      handleDOMEvents: {
        compositionend(v) {
          setTimeout(() => {
            if (!v.isDestroyed)
              v.dispatch(v.state.tr.setMeta("caseCompositionEnd", true));
          }, 0);
          return false;
        },
        contextmenu(v, event) {
          refreshEditorDecorations(v);
          openContextMenu(
            event,
            [
              {
                label: "Undo",
                disabled: !v.editable || !undo(v.state),
                run: () => {
                  undo(v.state, v.dispatch);
                  v.focus();
                },
              },
              {
                label: "Redo",
                disabled: !v.editable || !redo(v.state),
                run: () => {
                  redo(v.state, v.dispatch);
                  v.focus();
                },
              },
              {
                label: "Cut",
                disabled: !v.editable || v.state.selection.empty,
                run: () => {
                  v.dispatch(closeHistory(v.state.tr));
                  v.focus();
                  editCommand("cut");
                },
              },
              {
                label: "Copy",
                disabled: v.state.selection.empty,
                run: () => {
                  v.focus();
                  editCommand("copy");
                },
              },
              {
                label: "Paste",
                disabled: !v.editable,
                run: () => {
                  v.focus();
                  editCommand("paste");
                },
              },
              {
                label: "Select all",
                run: () => {
                  v.dispatch(
                    v.state.tr.setSelection(new AllSelection(v.state.doc)),
                  );
                  v.focus();
                },
              },
            ],
            { label: "Text actions" },
          );
          return true;
        },
        blur(v) {
          if (
            !latest.current.persistentCaret ||
            !(v.state.selection instanceof TextSelection)
          )
            return false;
          // A toolbar can take focus before selectionchange has updated the
          // editor state. Retain the actual cursor for unfocused drawing/reading.
          const live = v.dom.ownerDocument.getSelection();
          if (
            live?.anchorNode &&
            live.focusNode &&
            v.dom.contains(live.anchorNode) &&
            v.dom.contains(live.focusNode)
          ) {
            const selection = TextSelection.between(
              v.state.doc.resolve(
                v.posAtDOM(live.anchorNode, live.anchorOffset),
              ),
              v.state.doc.resolve(v.posAtDOM(live.focusNode, live.focusOffset)),
            );
            if (!selection.eq(v.state.selection))
              v.dispatch(v.state.tr.setSelection(selection));
          }
          return false;
        },
        focus() {
          latest.current.onFocus?.();
          return false;
        },
        drop(_v, event) {
          if (blocked.current) return false;
          const e = event as DragEvent,
            raw = e.dataTransfer?.getData("application/x-alder-idea");
          if (!raw) return false;
          try {
            const idea: Idea = JSON.parse(raw),
              at = v.posAtCoords({ left: e.clientX, top: e.clientY });
            if (at) {
              const position = TextSelection.near(
                v.state.doc.resolve(at.pos),
              ).$from;
              const parent = position.parent;
              const before = parent.textBetween(0, position.parentOffset);
              const after = parent.textBetween(
                position.parentOffset,
                parent.content.size,
              );
              v.dispatch(
                v.state.tr.insertText(
                  spacedWord(idea.word, before, after),
                  position.pos,
                ),
              );
            }
            e.preventDefault();
            return true;
          } catch {
            return false;
          }
        },
      },
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
      selection.current = null;
      annotationSource.current = null;
    };
  }, [props.identity]);
  useLayoutEffect(() => {
    const v = view.current,
      json = JSON.stringify(props.document);
    if (v && json !== lastJSON.current) {
      const parsed = parseEditorDocument(props.document);
      // Source paragraphs omit default attributes. Equivalent parent updates
      // must not recreate editor state, reset the caret or clear undo history.
      if (parsed.document?.eq(v.state.doc) && !blocked.current) {
        lastJSON.current = json;
        return;
      }
      blocked.current = !parsed.document;
      setParseError(parsed.error);
      setRangeWarning("");
      selection.current = null;
      annotationSource.current = null;
      latest.current.onSelection("", "");
      const doc =
        parsed.document || schema.node("doc", null, [schema.node("paragraph")]);
      pageDecorations.current = DecorationSet.empty;
      v.updateState(EditorState.create({ doc, plugins: v.state.plugins }));
      lastJSON.current = json;
    }
  }, [props.document]);
  useLayoutEffect(() => {
    const v = view.current;
    if (v) {
      annotationSource.current =
        !blocked.current && props.annotations
          ? (props.annotationText ?? projectText(v.state.doc).text)
          : null;
      refreshEditorDecorations(v);
    }
  }, [visibleAnnotations, props.annotationText]);
  useLayoutEffect(() => {
    if (view.current) refreshEditorDecorations(view.current);
  }, [props.showStructure]);
  useLayoutEffect(() => {
    const v = view.current;
    if (!v) return;
    refreshEditorDecorations(v);
  }, [props.readingRange, props.layoutVisible]);
  useLayoutEffect(() => {
    const layout = props.pageLayout;
    const scroll = host.current?.closest<HTMLElement>(".editor-scroll");
    if (!layout || !scroll || props.layoutVisible === false) return;
    const centrePage = () => {
      const style = getComputedStyle(scroll);
      const available =
        scroll.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      setPageInset(Math.max(0, (available / layout.zoom - layout.width) / 2));
    };
    centrePage();
    const observer = new ResizeObserver(centrePage);
    observer.observe(scroll);
    return () => observer.disconnect();
  }, [props.pageLayout?.width, props.pageLayout?.zoom, props.layoutVisible]);
  useLayoutEffect(() => {
    const v = view.current;
    if (
      !v ||
      !props.pageLayout ||
      blocked.current ||
      (props.layoutVisible === false && !props.capturePages)
    )
      return;
    let frame = 0;
    let forceMeasurement = false;
    const measure = (force = false) => {
      forceMeasurement ||= force;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!view.current || !v.dom.getBoundingClientRect().width) return;
        const settings = latest.current;
        const key = JSON.stringify([
          settings.pageLayout,
          settings.capturePages,
          settings.layoutVisible,
          settings.fontFamily,
          settings.fontSize,
          namedStyles.css,
          v.dom.getBoundingClientRect().width,
        ]);
        if (
          !forceMeasurement &&
          lastPageMeasurement.current?.doc === v.state.doc &&
          lastPageMeasurement.current.key === key
        )
          return;
        forceMeasurement = false;
        const viewport = v.dom.closest<HTMLElement>(".editor-scroll");
        const scrollTop = viewport?.scrollTop;
        const scrollLeft = viewport?.scrollLeft;
        refreshEditorDecorations(v);
        const layout = latest.current.pageLayout!;
        const pages = paginatePages(v, layout, (decorations) => {
          pageDecorations.current = decorations;
          v.updateState(v.state);
        });
        if (viewport && scrollTop !== undefined && scrollLeft !== undefined) {
          viewport.scrollTop = scrollTop;
          viewport.scrollLeft = scrollLeft;
        }
        measuredPages.current = pages;
        setFlowPages((old) =>
          JSON.stringify(old) === JSON.stringify(pages) ? old : pages,
        );
        latest.current.onPages?.(pages);
        if (latest.current.capturePages)
          latest.current.onPageSnapshots?.(
            pageSnapshots(v.dom, layout, pages.length, v),
          );
        lastPageMeasurement.current = { doc: v.state.doc, key };
      });
    };
    measure();
    // Pagination itself changes the editor height. Observing that height can
    // schedule another full pagination after every drop (and keep doing so).
    // Document edits, image loads and font changes have their own invalidation.
    const widths = new WeakMap<Element, number>();
    const observer = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const width = entry.contentRect.width;
        const previous = widths.get(entry.target);
        widths.set(entry.target, width);
        if (previous !== undefined && Math.abs(width - previous) > 0.5)
          changed = true;
      }
      if (changed) measure(true);
    });
    observer.observe(v.dom);
    const viewport = v.dom.closest(".editor-scroll");
    if (viewport) observer.observe(viewport);
    const assetsChanged = () => measure(true);
    v.dom.addEventListener("load", assetsChanged, true);
    document.fonts.addEventListener("loadingdone", assetsChanged);
    window.addEventListener("alder-fonts-changed", assetsChanged);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      v.dom.removeEventListener("load", assetsChanged, true);
      document.fonts.removeEventListener("loadingdone", assetsChanged);
      window.removeEventListener("alder-fonts-changed", assetsChanged);
    };
  }, [
    documentVersion,
    props.identity,
    props.document,
    props.pageLayout?.width,
    props.pageLayout?.height,
    props.pageLayout?.margin,
    props.pageLayout?.lineHeight,
    props.pageLayout?.zoom,
    props.layoutVisible,
    props.capturePages,
    props.styles,
    props.fontSize,
    props.fontFamily,
  ]);
  const mark = (name: string) =>
    view.current
      ? Boolean(
          schema.marks[name].isInSet(
            view.current.state.storedMarks ||
              view.current.state.selection.$from.marks(),
          ),
        )
      : false;
  const setFont = (name: string, value: any) => {
    const v = editableView();
    if (!v) return;
    const previous = selectedTextStyle(v.state);
    const m = schema.marks.text_style.create({ ...previous, [name]: value });
    const tr = v.state.tr;
    if (v.state.selection.empty) tr.addStoredMark(m);
    else tr.addMark(v.state.selection.from, v.state.selection.to, m);
    v.dispatch(tr);
    v.focus();
  };
  const align = (value: string) => {
    const v = editableView();
    if (!v) return;
    const tr = v.state.tr;
    v.state.doc.nodesBetween(
      v.state.selection.from,
      v.state.selection.to,
      (n, pos) => {
        if (n.isTextblock)
          tr.setNodeMarkup(pos, undefined, { ...n.attrs, align: value });
      },
    );
    v.dispatch(tr);
    v.focus();
  };
  const table = () => {
    const v = editableView();
    if (!v) return;
    const cell = () =>
      schema.nodes.table_cell.create(null, schema.nodes.paragraph.create());
    const row = () =>
      schema.nodes.table_row.create(null, [cell(), cell(), cell()]);
    v.dispatch(
      v.state.tr.replaceSelectionWith(
        schema.nodes.table.create(null, [row(), row(), row()]),
      ),
    );
    v.focus();
  };
  return (
    <div
      className={
        "editor-shell" +
        (props.rawMode ? " raw-mode" : "") +
        (props.pageLayout ? " paginated-editor" : "") +
        (props.persistentCaret ? " persistent-caret" : "")
      }
      data-alder-editor={editorScope}
    >
      <style>{namedStyles.css}</style>
      {(parseError || namedStyles.error || rangeWarning) && (
        <div
          className="editor-source-warning"
          role={parseError ? "alert" : "status"}
          style={{
            padding: "7px 10px",
            background: "#eee0ad",
            color: "#302e25",
            fontSize: 12,
            borderBottom: "1px solid #8b8060",
          }}
        >
          {parseError || namedStyles.error || rangeWarning}
        </div>
      )}
      <div
        className="format-toolbar"
        role="toolbar"
        aria-label="Text formatting"
        aria-disabled={!!parseError}
        inert={!!parseError}
      >
        {!props.rawMode && (
          <>
            <select
              aria-label="Paragraph type"
              defaultValue="paragraph"
              onChange={(e) =>
                command(
                  setBlockType(
                    e.target.value === "paragraph"
                      ? schema.nodes.paragraph
                      : schema.nodes.heading,
                    e.target.value === "paragraph"
                      ? null
                      : { level: Number(e.target.value) },
                  ),
                )
              }
            >
              <option value="paragraph">Body</option>
              <option value="1">Heading 1</option>
              <option value="2">Heading 2</option>
              <option value="3">Heading 3</option>
            </select>
            <select
              aria-label="Font family"
              title={
                fontCatalogue.missing
                  ? `${currentFont} is unavailable. Displaying ${fontCatalogue.fallback}; the saved font choice is preserved.`
                  : "Font family"
              }
              value={currentFont}
              onChange={(e) => setFont("fontFamily", e.target.value)}
            >
              {installedFonts.map((f) => (
                <option key={f} value={f}>
                  {f}
                  {f === currentFont && fontCatalogue.missing
                    ? " (unavailable)"
                    : ""}
                </option>
              ))}
            </select>
            <select
              aria-label="Font size"
              defaultValue="12"
              onChange={(e) => setFont("fontSize", Number(e.target.value))}
            >
              {[9, 10, 11, 12, 14, 16, 18, 24, 32].map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
            <button
              data-help-label={shortcutLabel("Bold (Ctrl+B)")}
              aria-label="Bold"
              className={mark("strong") ? "active" : ""}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => command(toggleMark(schema.marks.strong))}
            >
              <Bold />
            </button>
            <button
              data-help-label={shortcutLabel("Italic (Ctrl+I)")}
              aria-label="Italic"
              className={mark("em") ? "active" : ""}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => command(toggleMark(schema.marks.em))}
            >
              <Italic />
            </button>
            <button
              data-help-label={shortcutLabel("Underline (Ctrl+U)")}
              aria-label="Underline"
              className={mark("underline") ? "active" : ""}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => command(toggleMark(schema.marks.underline))}
            >
              <Underline />
            </button>
            <i />
            <button
              data-help-label="Align left"
              aria-label="Align left"
              onClick={() => align("left")}
            >
              <AlignLeft />
            </button>
            <button
              data-help-label="Align centre"
              aria-label="Align centre"
              onClick={() => align("center")}
            >
              <AlignCenter />
            </button>
            <button
              data-help-label="Align right"
              aria-label="Align right"
              onClick={() => align("right")}
            >
              <AlignRight />
            </button>
            <button
              data-help-label="Justify"
              aria-label="Justify"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => align("justify")}
            >
              <AlignJustify />
            </button>
            <button
              data-help-label="Bullet list"
              aria-label="Bullet list"
              onClick={() => command(wrapInList(schema.nodes.bullet_list))}
            >
              <List />
            </button>
            <button
              data-help-label="Numbered list"
              aria-label="Numbered list"
              onClick={() => command(wrapInList(schema.nodes.ordered_list))}
            >
              <ListOrdered />
            </button>
            <button
              data-help-label="Block quote"
              aria-label="Block quote"
              onClick={() => command(wrapIn(schema.nodes.blockquote))}
            >
              <Quote />
            </button>
            <i />
            <button
              data-help-label="Insert image"
              aria-label="Insert image"
              onClick={props.onImage}
            >
              <ImagePlus />
            </button>
            <button
              data-help-label="Insert table"
              aria-label="Insert table"
              onClick={table}
            >
              <Table2 />
            </button>
            <button
              data-help-label="Add table row"
              aria-label="Add table row"
              onClick={() => command(addRowAfter)}
            >
              +row
            </button>
            <button
              data-help-label="Add table column"
              aria-label="Add table column"
              onClick={() => command(addColumnAfter)}
            >
              +col
            </button>
            <button
              data-help-label="Delete table"
              aria-label="Delete table"
              onClick={() => command(deleteTable)}
            >
              &minus;table
            </button>
            <button
              data-help-label="Insert link"
              aria-label="Insert link"
              onClick={props.onLink}
            >
              <Link />
            </button>
            <button
              data-help-label="Insert page break"
              aria-label="Insert page break"
              onClick={() => {
                const v = editableView();
                if (v)
                  v.dispatch(
                    v.state.tr.replaceSelectionWith(
                      schema.nodes.page_break.create(),
                    ),
                  );
              }}
            >
              <WrapText />
            </button>
          </>
        )}
        <button
          aria-label="Spelling and grammar"
          aria-pressed={spellcheck}
          className={spellcheck ? "active" : ""}
          data-help="Show or hide spelling and grammar checks. Both are hidden during TTS playback."
          onClick={() => setSpellcheck(String(!spellcheck))}
        >
          <SpellCheck />
        </button>
        <select
          aria-label="Case"
          value={caseMode}
          data-help={
            props.caseScope === "document"
              ? "Change case throughout this sandbox draft and future input. Free leaves input unchanged."
              : "Change case in selected text and use this case for new writing. Free leaves input unchanged."
          }
          onChange={(event) => {
            const v = view.current;
            if (!v || blocked.current) return;
            const chosen = event.target.value as CaseMode;
            inputCase.current = chosen;
            setCaseMode(chosen);
            if (chosen === "free") {
              v.focus();
              return;
            }
            // A native dropdown can take focus before selectionchange reaches ProseMirror.
            const live = v.dom.ownerDocument.getSelection();
            if (
              props.caseScope !== "document" &&
              live?.anchorNode &&
              live.focusNode &&
              v.dom.contains(live.anchorNode) &&
              v.dom.contains(live.focusNode)
            ) {
              v.dispatch(
                v.state.tr.setSelection(
                  TextSelection.between(
                    v.state.doc.resolve(
                      v.posAtDOM(live.anchorNode, live.anchorOffset),
                    ),
                    v.state.doc.resolve(
                      v.posAtDOM(live.focusNode, live.focusOffset),
                    ),
                  ),
                ),
              );
            }
            v.dispatch(
              changeCase(
                v.state,
                event.target.value as LetterCase,
                props.caseScope === "document",
              ),
            );
            v.focus();
          }}
        >
          <option value="free">Free</option>
          <option value="sentence">Sentence case</option>
          <option value="lower">lowercase</option>
          <option value="upper">UPPERCASE</option>
          <option value="title">Title Case</option>
        </select>
        <button
          className={props.showStructure ? "active" : ""}
          data-help-label="Show structure"
          aria-label="Show structure"
          aria-pressed={props.showStructure}
          onClick={props.onToggleStructure}
        >
          <Pilcrow />
        </button>
        {props.onToggleRaw && (
          <button
            type="button"
            aria-label="Raw"
            aria-pressed={!!props.rawMode}
            disabled={props.rawDisabled}
            onClick={props.onToggleRaw}
            data-help="Edit source markup on the document pages. Turn Raw off to return to formatted writing."
          >
            Raw
          </button>
        )}
        <span className="toolbar-spacer" />
        <button
          data-help-label="Undo typing"
          aria-label="Undo typing"
          onClick={() => command(undo)}
        >
          <Undo2 />
        </button>
        <button
          data-help-label="Redo typing"
          aria-label="Redo typing"
          onClick={() => command(redo)}
        >
          <Redo2 />
        </button>
        {props.toolbarContent}
      </div>
      <div
        className={
          "editor-scroll" + (props.showStructure ? " show-structure" : "")
        }
        onScroll={(e) => {
          if (!props.pageLayout) return;
          const pitch =
            (props.pageLayout.height + PAGE_GAP) * props.pageLayout.zoom;
          const page = Math.max(
            0,
            Math.min(
              flowPages.length - 1,
              Math.floor((e.currentTarget.scrollTop + 24) / pitch),
            ),
          );
          props.onVisiblePage?.(page);
        }}
        style={{
          fontFamily: props.fontFamily || DOCUMENT_FONT,
          fontSize: `${props.fontSize || 15}px`,
        }}
      >
        {props.pageLayout ? (
          <div
            className="flow-canvas"
            style={
              {
                "--page-width": `${props.pageLayout.width}px`,
                "--page-height": `${props.pageLayout.height}px`,
                "--page-margin": `${props.pageLayout.margin}px`,
                "--page-gap": `${PAGE_GAP}px`,
                "--page-leading": props.pageLayout.lineHeight,
                width: props.pageLayout.width,
                minHeight:
                  Math.max(1, flowPages.length) *
                    (props.pageLayout.height + PAGE_GAP) -
                  PAGE_GAP,
                zoom: props.pageLayout.zoom,
                marginInline: pageInset,
              } as React.CSSProperties
            }
          >
            <div className="page-sheets" aria-hidden="true">
              {Array.from({ length: Math.max(1, flowPages.length) }, (_, i) => (
                <div className="page-sheet" key={i}>
                  <span>{i + 1}</span>
                </div>
              ))}
            </div>
            <div className="page-flow" ref={host} />
          </div>
        ) : (
          <div ref={host} />
        )}
      </div>
    </div>
  );
});
