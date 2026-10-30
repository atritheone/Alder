import type { Node as PMNode, NodeSpec } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";
import { closeHistory } from "prosemirror-history";
import type { DocNode, Project } from "./types";
import { documentText } from "./textProjection";
import { numberProjectCaptions, numberedDocument } from "./documentCaptions";
import { updateDocumentFields } from "./documentFields";
import { advanceHeading } from "./headingNumbering";
import { resolveStyles } from "./styleResolution";
import type { NamedStyle } from "./types";
import { refreshedContents } from "./documentContents";
import type { IndexSource } from "./documentIndex";
import { noteCounter, type NoteContext, type NoteOptions } from "./noteOptions";
import { formatPageNumber } from "./pageNumbering";

export type ReferenceFormat = "text" | "labelNumber" | "number" | "page";
export const referenceFormat = (value: unknown): ReferenceFormat =>
  value === "labelNumber" || value === "number" || value === "page"
    ? value
    : "text";

export const referenceSpec: NodeSpec = {
  inline: true,
  group: "inline",
  content: "text*",
  atom: true,
  selectable: true,
  attrs: {
    targetId: { default: "" },
    blockId: { default: null },
    unresolved: { default: false },
    referenceFormat: { default: "text" },
  },
  parseDOM: [
    {
      tag: "span[data-cross-reference]",
      getAttrs: (dom) => {
        const targetId = dom.getAttribute("data-cross-reference") || "";
        return /^[A-Za-z0-9_.-]{1,128}$/.test(targetId)
          ? {
              targetId,
              referenceFormat: referenceFormat(
                dom.getAttribute("data-reference-format"),
              ),
              unresolved:
                dom.getAttribute("data-reference-unresolved") === "true",
            }
          : false;
      },
    },
  ],
  toDOM: (node) => [
    "span",
    {
      "data-cross-reference": node.attrs.targetId,
      "data-reference-format": node.attrs.referenceFormat,
      "data-reference-unresolved": node.attrs.unresolved ? "true" : null,
      class: "document-reference",
      contenteditable: "false",
      title: node.attrs.unresolved
        ? "Reference unavailable. The last wording is retained."
        : "Cross-reference. Ctrl-click (Command-click on Mac) to go to its source.",
    },
    0,
  ],
};

type Piece = string | { reference: string; format: ReferenceFormat };
export type ReferenceTarget = {
  id: string;
  label: string;
  kind: "heading" | "bookmark" | "caption" | "note";
  chapter?: string;
  level?: number;
  captionLabel?: string;
  pieces: Piece[];
  labelNumber?: Piece[];
  number?: Piece[];
  page?: Piece[];
  valid: boolean;
  layoutDependent?: boolean;
};
export type ReferenceIndex = ReturnType<typeof referenceIndex>;

/** Index once per explicit update, never per spoken word or keystroke. */
export function referenceIndex(
  documents: {
    document: DocNode;
    chapter?: string;
    title?: string;
    resetNumbering?: boolean;
  }[],
  styles: NamedStyle[] = [],
  noteSettings?: NoteOptions,
  noteContext?: NoteContext,
) {
  let notes = noteCounter(noteSettings, noteContext);
  const headingCounts = [0, 0, 0, 0, 0, 0],
    resolvedStyles = resolveStyles(styles);
  const targets = new Map<string, ReferenceTarget>();
  const indexEntries: IndexSource[] = [];
  const put = (target: ReferenceTarget) => {
    if (!target.id) return;
    if (targets.has(target.id)) targets.get(target.id)!.valid = false;
    else targets.set(target.id, target);
  };
  for (const source of documents) {
    if (source.resetNumbering) {
      headingCounts.fill(0);
      notes = noteCounter(noteSettings);
    }
    const tape: Piece[] = [],
      starts = new Map<string, { at: number; name: string; range: boolean }>(),
      ends = new Map<string, number[]>();
    const collect = (node: DocNode) => {
      if (node.type === "table_of_contents") return;
      if (node.marks?.some((mark) => mark.type === "revision_deletion")) return;
      const attrs = node.attrs || {},
        at = tape.length;
      if (node.type === "section_break") notes.section(attrs.noteOptions);
      if (node.type === "document_note") {
        const kind = attrs.kind as "footnote" | "endnote",
          next = notes.next(kind),
          layoutDependent = next.layoutDependent,
          number = layoutDependent
            ? "—"
            : formatPageNumber(next.value, next.format);
        put({
          id: attrs.blockId,
          label: `${kind === "footnote" ? "Footnote" : "Endnote"} ${number} · ${documentText(attrs.body).slice(0, 100)}`,
          kind: "note",
          chapter: source.chapter,
          pieces: [],
          number: [number],
          valid: true,
          layoutDependent,
        });
        return;
      }
      if (node.type === "index_entry") {
        indexEntries.push({
          id: attrs.blockId,
          terms: attrs.terms,
          see: attrs.see,
          chapter: source.chapter,
        });
        return;
      }
      if (node.type === "text") tape.push(node.text || "");
      else if (node.type === "cross_reference")
        tape.push(
          attrs.referenceFormat === "page"
            ? documentText(node)
            : {
                reference: attrs.targetId,
                format: referenceFormat(attrs.referenceFormat),
              },
        );
      else if (node.type === "bookmark")
        starts.set(attrs.blockId, {
          at,
          name: attrs.name,
          range: !!attrs.range,
        });
      else if (node.type === "bookmark_end")
        ends.set(attrs.targetId, [...(ends.get(attrs.targetId) || []), at]);
      else {
        let number: Piece[] | undefined, labelNumber: Piece[] | undefined;
        let sequences = 0;
        const headingNumber =
          node.type === "heading" &&
          (attrs.headingNumbered ??
            resolvedStyles.get(attrs.styleId)?.headingNumbered)
            ? advanceHeading(
                headingCounts,
                attrs.level || 1,
                attrs.headingStart,
              )
            : null;
        node.content?.forEach((child) => {
          const start = tape.length;
          collect(child);
          if (
            attrs.captionLabel &&
            child.type === "sequence" &&
            child.attrs?.sequenceName === attrs.captionLabel
          ) {
            sequences++;
            number = tape.slice(start);
            labelNumber = tape.slice(at);
          }
        });
        if (node.type === "heading" || attrs.captionLabel)
          put({
            id: attrs.blockId,
            label: documentText(node) || "Untitled heading",
            kind: attrs.captionLabel ? "caption" : "heading",
            chapter: source.chapter,
            level: node.type === "heading" ? attrs.level || 1 : undefined,
            captionLabel: attrs.captionLabel,
            pieces: tape.slice(at),
            ...(sequences === 1 ? { number, labelNumber } : {}),
            ...(headingNumber ? { number: [headingNumber] } : {}),
            valid: true,
          });
        if (
          ["paragraph", "heading", "hard_break", "hardBreak"].includes(
            node.type,
          )
        )
          tape.push(" ");
      }
    };
    collect(source.document);
    for (const [id, start] of starts) {
      const closing = ends.get(id);
      put({
        id,
        label: start.name,
        kind: "bookmark",
        chapter: source.chapter,
        pieces: closing?.length === 1 ? tape.slice(start.at, closing[0]) : [],
        valid:
          !start.range || !!(closing?.length === 1 && closing[0] >= start.at),
      });
    }
  }
  const values = new Map<string, string | null>(),
    visiting = new Set<string>();
  const resolve = (
    id: string,
    format: ReferenceFormat = "text",
    depth = 0,
  ): string | null => {
    const key = `${id}:${format}`;
    if (values.has(key)) return values.get(key)!;
    const target = targets.get(id);
    const source = format === "text" ? target?.pieces : target?.[format];
    if (!target?.valid || !source || visiting.has(key) || depth > 50)
      return null;
    visiting.add(key);
    const pieces = source.map((piece) =>
      typeof piece === "string"
        ? piece
        : resolve(piece.reference, piece.format, depth + 1),
    );
    visiting.delete(key);
    const value = pieces.includes(null)
      ? null
      : pieces.join("").replace(/\s+/gu, " ").trim();
    const result = value && value.length <= 10000 ? value : null;
    values.set(key, result);
    return result;
  };
  for (const id of targets.keys()) resolve(id);
  return { targets, resolve, indexEntries };
}

export function projectReferenceIndex(project: Project, local?: DocNode) {
  return referenceIndex(
    [
      ...(local
        ? [{ document: local, title: "Sandbox", resetNumbering: true }]
        : []),
      ...(project.book?.chapters || [])
        .filter((c) => c.include !== false)
        .map((c, index) => ({
          document: c.document,
          chapter: c.id,
          title: c.title,
          resetNumbering: index === 0,
        })),
    ],
    project.styles,
    project.settings?.noteOptions,
  );
}

/** New generated lists use current sequence order without changing authored state. */
export function projectContentsIndex(project: Project) {
  const counts = { Figure: 0, Table: 0 };
  return referenceIndex(
    (project.book?.chapters || [])
      .filter((c) => c.include !== false)
      .map((c) => ({
        document: numberedDocument(c.document, counts),
        chapter: c.id,
        title: c.title,
      })),
    project.styles,
    project.settings?.noteOptions,
  );
}

export function refreshedReferences(
  document: DocNode,
  index: ReferenceIndex,
): DocNode {
  if (document.type === "cross_reference") {
    // Page values are refreshed from the complete publication's page map.
    if (
      document.attrs?.referenceFormat === "page" ||
      index.targets.get(document.attrs?.targetId)?.layoutDependent
    )
      return document;
    const text = index.resolve(
        document.attrs!.targetId,
        referenceFormat(document.attrs?.referenceFormat),
      ),
      unresolved = !text;
    if (
      unresolved === !!document.attrs?.unresolved &&
      (text ? text === documentText(document) : !!documentText(document))
    )
      return document;
    return {
      ...document,
      attrs: { ...document.attrs, unresolved },
      content: text
        ? [{ type: "text", text }]
        : document.content?.length
          ? document.content
          : [{ type: "text", text: "[Reference unavailable]" }],
    };
  }
  if (!document.content) return document;
  const content = document.content.map((child) =>
    refreshedReferences(child, index),
  );
  return content.every((node, i) => node === document.content![i])
    ? document
    : { ...document, content };
}

/** A deliberate project operation: all chapter references share one undo step. */
export function updateProjectReferences(project: Project) {
  updateDocumentFields(project);
  numberProjectCaptions(project);
  const index = projectReferenceIndex(project);
  for (const chapter of project.book?.chapters || []) {
    chapter.document = refreshedReferences(
      refreshedContents(chapter.document, index),
      index,
    );
    chapter.text = documentText(chapter.document);
  }
  for (const clip of project.clips) {
    const update = (value: { document: DocNode; text: string }) => {
      value.document = refreshedReferences(
        value.document,
        projectReferenceIndex(project, value.document),
      );
      value.text = documentText(value.document);
    };
    update(clip);
    clip.variants.forEach(update);
  }
}

export function insertReference(
  state: EditorState,
  targetId: string,
  text: string,
  format: ReferenceFormat = "text",
) {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(targetId) || !text || text.length > 10000)
    throw new Error("Choose an available heading or bookmarked passage.");
  return closeHistory(state.tr)
    .replaceSelectionWith(
      state.schema.nodes.cross_reference.create(
        {
          targetId,
          referenceFormat: format,
          blockId: `block_${crypto.randomUUID()}`,
        },
        state.schema.text(text),
      ),
      true,
    )
    .scrollIntoView();
}

/** Parent field refreshes must map the caret, not recreate the editor session. */
export function referenceRefreshTransaction(
  state: EditorState,
  next: PMNode,
): Transaction | null {
  const edits: { from: number; to: number; node: PMNode }[] = [];
  const compare = (before: PMNode, after: PMNode, pos: number): boolean => {
    if (before === after || before.eq(after)) return true;
    if (before.type !== after.type) return false;
    if (
      [
        "cross_reference",
        "sequence",
        "document_field",
        "table_of_contents",
        "citation",
        "bibliography",
      ].includes(before.type.name) &&
      before.attrs.targetId === after.attrs.targetId &&
      before.attrs.blockId === after.attrs.blockId
    ) {
      edits.push({ from: pos, to: pos + before.nodeSize, node: after });
      return true;
    }
    if (
      !before.sameMarkup(after) ||
      before.childCount !== after.childCount ||
      before.isText
    )
      return false;
    let offset = pos + (before.type.name === "doc" ? 0 : 1);
    for (let i = 0; i < before.childCount; i++) {
      if (!compare(before.child(i), after.child(i), offset)) return false;
      offset += before.child(i).nodeSize;
    }
    return true;
  };
  if (!compare(state.doc, next, 0) || !edits.length) return null;
  const tr = state.tr
    .setMeta("addToHistory", false)
    .setMeta("referenceRefresh", true);
  for (const edit of edits.reverse())
    tr.replaceWith(edit.from, edit.to, edit.node);
  return tr;
}
