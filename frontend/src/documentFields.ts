import type { NodeSpec } from "prosemirror-model";
import type { EditorState } from "prosemirror-state";
import { closeHistory } from "prosemirror-history";
import type { DocNode, Project } from "./types";
import { documentText } from "./textProjection";
import { updateRunningStories } from "./runningMatter";
import { headingFieldLabels, isHeadingField } from "./runningHeadings";

export const fieldLabels = {
  date: "Current date",
  title: "Document title",
  author: "Author",
  subject: "Subject",
  page: "Page number",
  pageCount: "Total pages",
  ...headingFieldLabels,
} as const;
export type DocumentField = keyof typeof fieldLabels;
export const isPageField = (value: unknown) =>
  value === "page" || value === "pageCount";
export const isLayoutField = (value: unknown) => isPageField(value) || isHeadingField(value);
export function isDocumentField(value: unknown): value is DocumentField {
  return typeof value === "string" && Object.hasOwn(fieldLabels, value);
}
export function documentFieldValues(
  project: Project,
  now = new Date(),
): Record<DocumentField, string> {
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  const text = (value: unknown) =>
    typeof value === "string"
      ? value.replace(/\s+/gu, " ").trim().slice(0, 10000)
      : "";
  return {
    date,
    title: text(project.name),
    author: text(project.settings.author),
    subject: text(project.settings.subject),
    page: "—",
    pageCount: "—",
    heading1: "—",
    heading2: "—",
    heading3: "—",
    heading4: "—",
    heading5: "—",
    heading6: "—",
  };
}
export const documentFieldSpec: NodeSpec = {
  inline: true,
  group: "inline",
  content: "text*",
  atom: true,
  attrs: {
    fieldKind: { default: "date" },
    blockId: { default: null },
    unresolved: { default: false },
  },
  parseDOM: [
    {
      tag: "span[data-document-field]",
      getAttrs: (dom) =>
        isDocumentField(dom.getAttribute("data-document-field"))
          ? {
              fieldKind: dom.getAttribute("data-document-field"),
              unresolved: dom.getAttribute("data-field-unresolved") === "true",
            }
          : false,
    },
  ],
  toDOM: (node) => [
    "span",
    {
      "data-document-field": node.attrs.fieldKind,
      "data-field-unresolved": node.attrs.unresolved ? "true" : null,
      class: "document-field",
      contenteditable: "false",
      title: node.attrs.unresolved
        ? isHeadingField(node.attrs.fieldKind)
          ? "No matching heading is available. Add a heading at this level, then update fields."
          : isPageField(node.attrs.fieldKind)
            ? "Page layout is unavailable. Edit → Update fields recalculates it."
            : "This document property is empty. Set it in Settings, then update fields."
        : `${fieldLabels[node.attrs.fieldKind as DocumentField]}. Edit → Update fields refreshes this value.`,
    },
    0,
  ],
};
export function refreshedDocumentFields(
  document: DocNode,
  values: Record<DocumentField, string>,
): DocNode {
  if (document.type === "document_field") {
    if (isLayoutField(document.attrs?.fieldKind)) return document;
    const kind = document.attrs!.fieldKind as DocumentField,
      value = values[kind];
    const text = value || `[${fieldLabels[kind]} not set]`,
      unresolved = !value;
    if (
      documentText(document) === text &&
      !!document.attrs?.unresolved === unresolved
    )
      return document;
    return {
      ...document,
      attrs: { ...document.attrs, unresolved },
      content: [{ type: "text", text }],
    };
  }
  if (!document.content) return document;
  const content = document.content.map((child) =>
    refreshedDocumentFields(child, values),
  );
  return content.every((child, index) => child === document.content![index])
    ? document
    : { ...document, content };
}
export function insertDocumentField(
  state: EditorState,
  kind: DocumentField,
  text: string,
  blockId = `block_${crypto.randomUUID()}`,
) {
  if (!isDocumentField(kind) || typeof text!=="string" || (!text&&!isHeadingField(kind)) || text.length > 10000)
    throw new Error("Choose a field with an available value.");
  return closeHistory(state.tr)
    .replaceSelectionWith(
      state.schema.nodes.document_field.create(
        { fieldKind: kind, blockId },
        text ? state.schema.text(text) : undefined,
      ),
      true,
    )
    .scrollIntoView();
}
export function updateDocumentFields(project: Project, now = new Date()) {
  const values = documentFieldValues(project, now);
  updateRunningStories(project, (doc) => refreshedDocumentFields(doc, values));
  for (const chapter of project.book?.chapters || [])
    chapter.document = refreshedDocumentFields(chapter.document, values);
  for (const clip of project.clips)
    for (const item of [clip, ...clip.variants])
      item.document = refreshedDocumentFields(item.document, values);
}
