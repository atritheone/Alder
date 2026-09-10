import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useRef,
  useState,
  useMemo,
  useId,
} from "react";
import { Schema, Node as PMNode, DOMParser, Fragment } from "prosemirror-model";
import { EditorState, Plugin, TextSelection } from "prosemirror-state";
import { EditorView, Decoration, DecorationSet } from "prosemirror-view";
import {
  baseKeymap,
  toggleMark,
  setBlockType,
  wrapIn,
  chainCommands,
  exitCode,
} from "prosemirror-commands";
import { history, undo, redo } from "prosemirror-history";
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
  Undo2,
  Redo2,
  WrapText,
  Pilcrow,
} from "lucide-react";
import type { Annotation, DocNode, Idea, Project, StyleKind } from "./types";
import { mediaUrl } from "./api";
import { projectText, projectedRange } from "./textProjection";
import { styleDeclarations, styleSheet } from "./styleResolution";

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
      parseDOM: [{ tag: "mark" }],
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
        "This clip contains a structure Alder cannot edit yet. The original source is preserved and can be exported.",
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
  insert: (text: string) => void;
  replace: (text: string) => void;
  replaceRange: (start: number, end: number, text: string) => void;
  selectRange: (start: number, end: number) => void;
  image: (src: string, assetId: string, alt: string) => void;
  link: (text: string, url: string) => void;
  style: (id: string, kind?: StyleKind) => void;
  focus: () => void;
  getSelection: () => string;
};
type Props = {
  document: DocNode;
  identity: string;
  onChange: (document: DocNode, text: string) => void;
  onSelection: (word: string, selection: string) => void;
  annotations?: Annotation[];
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
export default forwardRef<EditorHandle, Props>(function Editor(props, ref) {
  const editorScope = useId();
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
  latest.current = props;
  decos.current = props.annotations || [];
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
    const v = new EditorView(host.current, {
      state: EditorState.create({
        doc,
        plugins: [
          history(),
          keymap({
            "Ctrl-Space": () => {
              latest.current.onComplete?.();
              return true;
            },
            "Mod-z": undo,
            "Mod-y": redo,
            "Mod-Shift-z": redo,
            "Mod-b": toggleMark(schema.marks.strong),
            "Mod-i": toggleMark(schema.marks.em),
            "Mod-u": toggleMark(schema.marks.underline),
            Enter: splitListItem(schema.nodes.list_item),
            Tab: sinkListItem(schema.nodes.list_item),
            "Shift-Tab": liftListItem(schema.nodes.list_item),
            "Shift-Enter": chainCommands(exitCode, (state, dispatch) => {
              dispatch?.(
                state.tr.replaceSelectionWith(schema.nodes.hard_break.create()),
              );
              return true;
            }),
          }),
          keymap(baseKeymap),
          columnResizing(),
          tableEditing(),
          dropCursor(),
          new Plugin({
            props: {
              decorations(state) {
                if (blocked.current) return DecorationSet.empty;
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
                          class: `annotation annotation-${annotation.type}`,
                          title: annotation.message,
                        }),
                      );
                  } catch {
                    /* An outdated annotation must never address arbitrary editor positions. */
                  }
                }
                return DecorationSet.create(state.doc, spans);
              },
            },
          }),
        ],
      }),
      editable: () => !blocked.current,
      attributes: {
        role: "textbox",
        "aria-label": "Clip text editor",
        "aria-multiline": "true",
        spellcheck: "false",
      },
      dispatchTransaction(tr) {
        if (blocked.current && tr.docChanged) return;
        const next = v.state.apply(tr);
        if (tr.docChanged) annotationSource.current = null;
        v.updateState(next);
        if (tr.docChanged) {
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
              parent.slice(0, at).match(/[\p{L}\p{N}’'-]+$/u)?.[0] || "",
            right = parent.slice(at).match(/^[\p{L}\p{N}’'-]+/u)?.[0] || "";
          word = left + right;
          if (word)
            selection.current = {
              from: s.from - left.length,
              to: s.from + right.length,
              text: word,
            };
        } else if (!s.empty)
          selection.current = { from: s.from, to: s.to, text: selected };
        latest.current.onSelection(word, selected);
        tick((n) => n + 1);
      },
      handleDOMEvents: {
        drop(_v, event) {
          if (blocked.current) return false;
          const e = event as DragEvent,
            raw = e.dataTransfer?.getData("application/x-alder-idea");
          if (!raw) return false;
          try {
            const idea: Idea = JSON.parse(raw),
              at = v.posAtCoords({ left: e.clientX, top: e.clientY });
            if (at) v.dispatch(v.state.tr.insertText(idea.word, at.pos));
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
      blocked.current = !parsed.document;
      setParseError(parsed.error);
      setRangeWarning("");
      selection.current = null;
      annotationSource.current = null;
      latest.current.onSelection("", "");
      const doc =
        parsed.document || schema.node("doc", null, [schema.node("paragraph")]);
      v.updateState(EditorState.create({ doc, plugins: v.state.plugins }));
      lastJSON.current = json;
    }
  }, [props.document]);
  useLayoutEffect(() => {
    const v = view.current;
    if (v) {
      annotationSource.current =
        !blocked.current && props.annotations
          ? projectText(v.state.doc).text
          : null;
      v.updateState(v.state);
    }
  }, [props.annotations]);
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
    const previous =
      schema.marks.text_style.isInSet(
        v.state.storedMarks || v.state.selection.$from.marks(),
      )?.attrs || {};
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
    <div className="editor-shell" data-alder-editor={editorScope}>
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
          defaultValue="Georgia"
          onChange={(e) => setFont("fontFamily", e.target.value)}
        >
          {["Georgia", "Segoe UI", "Arial", "Times New Roman", "Consolas"].map(
            (f) => (
              <option key={f}>{f}</option>
            ),
          )}
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
          title="Bold (Ctrl+B)"
          aria-label="Bold"
          className={mark("strong") ? "active" : ""}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => command(toggleMark(schema.marks.strong))}
        >
          <Bold />
        </button>
        <button
          title="Italic (Ctrl+I)"
          aria-label="Italic"
          className={mark("em") ? "active" : ""}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => command(toggleMark(schema.marks.em))}
        >
          <Italic />
        </button>
        <button
          title="Underline (Ctrl+U)"
          aria-label="Underline"
          className={mark("underline") ? "active" : ""}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => command(toggleMark(schema.marks.underline))}
        >
          <Underline />
        </button>
        <i />
        <button
          title="Align left"
          aria-label="Align left"
          onClick={() => align("left")}
        >
          <AlignLeft />
        </button>
        <button
          title="Align centre"
          aria-label="Align centre"
          onClick={() => align("center")}
        >
          <AlignCenter />
        </button>
        <button
          title="Align right"
          aria-label="Align right"
          onClick={() => align("right")}
        >
          <AlignRight />
        </button>
        <button
          title="Bullet list"
          aria-label="Bullet list"
          onClick={() => command(wrapInList(schema.nodes.bullet_list))}
        >
          <List />
        </button>
        <button
          title="Numbered list"
          aria-label="Numbered list"
          onClick={() => command(wrapInList(schema.nodes.ordered_list))}
        >
          <ListOrdered />
        </button>
        <button
          title="Block quote"
          aria-label="Block quote"
          onClick={() => command(wrapIn(schema.nodes.blockquote))}
        >
          <Quote />
        </button>
        <i />
        <button
          title="Insert image"
          aria-label="Insert image"
          onClick={props.onImage}
        >
          <ImagePlus />
        </button>
        <button title="Insert table" aria-label="Insert table" onClick={table}>
          <Table2 />
        </button>
        <button title="Add table row" onClick={() => command(addRowAfter)}>
          +row
        </button>
        <button
          title="Add table column"
          onClick={() => command(addColumnAfter)}
        >
          +col
        </button>
        <button title="Delete table" onClick={() => command(deleteTable)}>
          −table
        </button>
        <button
          title="Insert link"
          aria-label="Insert link"
          onClick={props.onLink}
        >
          <Link />
        </button>
        <button
          title="Insert page break"
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
        <span className="toolbar-spacer" />
        <button
          className={props.showStructure ? "active" : ""}
          title="Show structure"
          aria-label="Show structure"
          onClick={props.onToggleStructure}
        >
          <Pilcrow />
        </button>
        <button
          title="Undo typing"
          aria-label="Undo typing"
          onClick={() => command(undo)}
        >
          <Undo2 />
        </button>
        <button
          title="Redo typing"
          aria-label="Redo typing"
          onClick={() => command(redo)}
        >
          <Redo2 />
        </button>
      </div>
      <div
        className={
          "editor-scroll" + (props.showStructure ? " show-structure" : "")
        }
        style={{
          fontFamily: props.fontFamily || "Georgia",
          fontSize: `${props.fontSize || 15}px`,
        }}
      >
        <div ref={host} />
      </div>
    </div>
  );
});
