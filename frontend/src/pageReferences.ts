import type { Node as PMNode } from "prosemirror-model";
import type { EditorState } from "prosemirror-state";
import type { DocNode, Project } from "./types";
import type { FlowPage, PageLayout } from "./pageFlow";
import { physicalPageAtPosition } from "./pageRanges";
import { formatPageNumber } from "./pageNumbering";
import { documentText } from "./textProjection";
import { isLayoutField } from "./documentFields";
import { storyDocuments, updateRunningStories } from "./runningMatter";
import { bodyHeading, isHeadingField } from "./runningHeadings";
import { indexPageText } from "./documentIndex";
import { documentNotes, assignPageNoteNumbers } from "./documentNotes";
import {documentBookmarks} from './documentBookmarks';

export type PageReferenceValues = {
  references: Record<string, string>;
  pages: number;
  fields?: Record<string, string>;
  noteNumbers?: Record<string, string>;
};
/** Labels come from the physical sheet and its section restart/number format. */
export function pageReferenceValues(
  doc: PMNode,
  pages: FlowPage[],
  layout: PageLayout,
): PageReferenceValues {
  const references: Record<string, string> = {};
  const fields: Record<string, string> = {};
  const ranged: {id:string;rangeId:string}[]=[];
  doc.descendants((node, pos) => {
    if (node.type.name === "table_of_contents") return false;
    if(node.type.name==='index_entry' && node.attrs.rangeId){ranged.push({id:node.attrs.blockId,rangeId:node.attrs.rangeId});return false;}
    if (
      !node.attrs.blockId ||
      !(
        node.type.name === "heading" ||
        node.type.name === "bookmark" ||
        node.type.name === "index_entry" ||
        node.type.name === "document_note" ||
        (node.type.name === "document_field" &&
          isLayoutField(node.attrs.fieldKind)) ||
        node.attrs.captionLabel
      )
    )
      return;
    const index = physicalPageAtPosition(
      pages,
      node.isTextblock
        ? pos + 1
        : node.type.name === "index_entry" && doc.resolve(pos).parentOffset > 0
          ? pos - 1
          : pos,
    );
    if (index == null) return;
    const current = pages[index].frame?.layout || layout;
    const label = formatPageNumber(
      index + (current.pageNumberOffset ?? current.firstPageNumber ?? 1),
      current.pageNumberFormat,
    );
    if (node.type.name === "document_field") {
      if (isHeadingField(node.attrs.fieldKind)) {
        const value = bodyHeading(doc, pos, node.attrs.fieldKind);
        if (value != null) fields[node.attrs.blockId] = value;
        return false;
      }
      fields[node.attrs.blockId] =
        node.attrs.fieldKind === "pageCount" ? String(pages.length) : label;
      return false;
    }
    references[node.attrs.blockId] = label;
  });
  if(ranged.length){
    const ranges=new Map(documentBookmarks(doc).map(b=>[b.id,b]));
    const label=(index:number)=>{const current=pages[index].frame?.layout||layout;return formatPageNumber(index+(current.pageNumberOffset??current.firstPageNumber??1),current.pageNumberFormat);};
    for(const entry of ranged){
      const range=ranges.get(entry.rangeId);
      if(!range || range.incomplete || range.end==null)continue;
      const first=physicalPageAtPosition(pages,range.pos+1),last=physicalPageAtPosition(pages,Math.max(range.pos+1,range.end-1));
      if(first==null || last==null || first>last)continue;
      references[entry.id]=first===last?label(first):`${label(first)}–${label(last)}`;
    }
  }
  let noteNumbers: Record<string, string> | undefined;
  if (
    documentNotes(doc, layout.noteStarts, layout.noteOptions).some(
      (note) =>
        note.value.kind === "footnote" &&
        note.options.footnote.restart === "page",
    )
  ) {
    assignPageNoteNumbers(doc, pages, layout.noteStarts, layout.noteOptions);
    noteNumbers = Object.fromEntries(
      documentNotes(doc, layout.noteStarts, layout.noteOptions)
        .filter((note) => note.value.kind === "footnote")
        .map((note) => [note.id, note.number]),
    );
  }
  return {
    references,
    pages: pages.length,
    ...(Object.keys(fields).length ? { fields } : {}),
    ...(noteNumbers ? { noteNumbers } : {}),
  };
}
export function pageReferenceTransaction(
  state: EditorState,
  values: PageReferenceValues,
) {
  const edits: {
    pos: number;
    node: PMNode;
    text: string;
    unresolved: boolean;
  }[] = [];
  state.doc.descendants((node, pos) => {
    const pageField =
      node.type.name === "document_field" &&
      isLayoutField(node.attrs.fieldKind);
    const indexField = node.type.name === "index_reference";
    const noteNumber =
      node.type.name === "cross_reference" &&
      node.attrs.referenceFormat !== "page"
        ? values.noteNumbers?.[node.attrs.targetId]
        : undefined;
    if (
      !pageField &&
      !indexField &&
      noteNumber == null &&
      (node.type.name !== "cross_reference" ||
        node.attrs.referenceFormat !== "page")
    )
      return;
    const text =
      noteNumber ??
      (indexField
        ? indexPageText(node.attrs.targetIds, values.references)
        : pageField
          ? values.fields?.[node.attrs.blockId]
          : values.references[node.attrs.targetId]);
    const unresolved = indexField
      ? node.attrs.targetIds.some((id: string) => values.references[id] == null)
      : text == null;
    if (
      node.textContent !== (text ?? (node.textContent || "—")) ||
      !!node.attrs.unresolved !== unresolved
    )
      edits.push({
        pos,
        node,
        text: text ?? (node.textContent || "—"),
        unresolved,
      });
    return false;
  });
  if (!edits.length) return null;
  const tr = state.tr
    .setMeta("addToHistory", false)
    .setMeta("referenceRefresh", true);
  for (const { pos, node, text, unresolved } of edits.reverse())
    tr.replaceWith(
      pos,
      pos + node.nodeSize,
      node.type.create(
        { ...node.attrs, unresolved },
        text ? state.schema.text(text) : undefined,
        node.marks,
      ),
    );
  return tr;
}
export function hasPageReferences(project: Project) {
  const pageNotes = (node: DocNode): boolean =>
    node.attrs?.noteOptions?.footnote?.restart === "page" ||
    !!node.content?.some(pageNotes);
  const perPage =
    project.settings.noteOptions?.footnote.restart === "page" ||
    project.book?.chapters.some(
      (c) => c.include !== false && pageNotes(c.document),
    );
  const has = (node: DocNode): boolean =>
    node.type === "index_reference" ||
    (node.type === "cross_reference" &&
      (node.attrs?.referenceFormat === "page" || perPage)) ||
    (node.type === "document_field" && isLayoutField(node.attrs?.fieldKind)) ||
    storyDocuments(node.attrs?.runningMatter).some(has) ||
    !!node.content?.some(has);
  return (
    storyDocuments(project.settings?.runningMatter).some(has) ||
    project.book?.chapters.some(
      (c) => c.include !== false && has(c.document),
    ) ||
    false
  );
}
export function updatePageReferences(
  project: Project,
  values: PageReferenceValues,
) {
  const totals = (node: DocNode): DocNode =>
    node.type === "document_field" && node.attrs?.fieldKind === "pageCount"
      ? {
          ...node,
          attrs: { ...node.attrs, unresolved: false },
          content: [{ type: "text", text: String(values.pages) }],
        }
      : {
          ...node,
          ...(node.content ? { content: node.content.map(totals) } : {}),
        };
  updateRunningStories(project, totals);
  const refresh = (node: DocNode): void => {
    const pageField =
      node.type === "document_field" && isLayoutField(node.attrs?.fieldKind);
    const indexField = node.type === "index_reference";
    const noteNumber =
      node.type === "cross_reference" && node.attrs?.referenceFormat !== "page"
        ? values.noteNumbers?.[node.attrs?.targetId]
        : undefined;
    if (
      pageField ||
      indexField ||
      noteNumber != null ||
      (node.type === "cross_reference" &&
        node.attrs?.referenceFormat === "page")
    ) {
      const text =
        noteNumber ??
        (indexField
          ? indexPageText(node.attrs!.targetIds, values.references)
          : pageField
            ? values.fields?.[node.attrs!.blockId]
            : values.references[node.attrs!.targetId]);
      node.attrs!.unresolved = indexField
        ? node.attrs!.targetIds.some(
            (id: string) => values.references[id] == null,
          )
        : text == null;
      if (text != null) node.content = text ? [{ type: "text", text }] : [];
    }
    node.content?.forEach(refresh);
  };
  for (const chapter of project.book?.chapters || []) {
    refresh(chapter.document);
    chapter.text = documentText(chapter.document);
  }
}
