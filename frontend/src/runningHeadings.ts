import type { Node as PMNode } from "prosemirror-model";
import type { FlowPage, PageLayout } from "./pageFlow";
import { pageFrame } from "./sectionLayout";
import { physicalPageAtPosition } from "./pageRanges";
import { documentText } from "./textProjection";
import type { DocNode, Project } from "./types";

export const headingFieldLabels = {
  heading1: "Heading 1",
  heading2: "Heading 2",
  heading3: "Heading 3",
  heading4: "Heading 4",
  heading5: "Heading 5",
  heading6: "Heading 6",
} as const;
export type HeadingField = keyof typeof headingFieldLabels;
export const isHeadingField = (value: unknown): value is HeadingField =>
  typeof value === "string" && Object.hasOwn(headingFieldLabels, value);
type Heading = { pos: number; level: number; text: string };
const headings = new WeakMap<PMNode, Heading[]>();
export type HeadingContext = {
  before: Partial<Record<HeadingField, string>>;
  after: Partial<Record<HeadingField, string>>;
  title?: string;
};
const documentHeadings = new WeakMap<
  DocNode,
  { kind: HeadingField; text: string }[]
>();
function jsonHeadings(document: DocNode) {
  let entries = documentHeadings.get(document);
  if (entries) return entries;
  entries = [];
  const walk = (node: DocNode) => {
    if (node.type === "table_of_contents") return;
    if (node.type === "heading") {
      entries!.push({
        kind: `heading${node.attrs?.level || 1}` as HeadingField,
        text: documentText(headingText(node)).replace(/\s+/gu, " ").trim(),
      });
      return;
    }
    node.content?.forEach(walk);
  };
  walk(document);
  documentHeadings.set(document, entries);
  return entries;
}
/** Supply the preceding/following included chapters to a single-chapter editor. */
export function chapterHeadingContext(
  project: Project,
  id: string,
): HeadingContext {
  const before: HeadingContext["before"] = {},
    after: HeadingContext["after"] = {};
  let current = false,
    title: string | undefined;
  const chapterTitles = !["txt", "docx"].includes(
    project.settings.documentKind || "book",
  );
  for (const chapter of project.book?.chapters || []) {
    if (chapter.id === id) {
      current = true;
      if (chapterTitles) title = chapter.title;
      continue;
    }
    if (chapter.include === false) continue;
    const entries = [
      ...(chapterTitles
        ? [{ kind: "heading1" as HeadingField, text: chapter.title }]
        : []),
      ...jsonHeadings(chapter.document),
    ];
    for (const item of entries) {
      if (current) after[item.kind] ??= item.text;
      else before[item.kind] = item.text;
    }
  }
  return { before, after, ...(title ? { title } : {}) };
}
// A heading field inside its own source cannot recursively contribute its
// cached result. Other generated text (for example a document title) can.
function headingText(node: DocNode): DocNode {
  if (node.type === "document_field" && isHeadingField(node.attrs?.fieldKind))
    return { type: "text", text: "" };
  return node.content
    ? { ...node, content: node.content.map(headingText) }
    : node;
}
export function headingIndex(doc: PMNode): Heading[] {
  let result = headings.get(doc);
  if (result) return result;
  result = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "table_of_contents") return false;
    if (node.type.name !== "heading") return;
    result!.push({
      pos: pos + 1,
      level: Number(node.attrs.level) || 1,
      text: documentText(headingText(node.toJSON()))
        .replace(/\s+/gu, " ")
        .trim(),
    });
    return false;
  });
  headings.set(doc, result);
  return result;
}
/** Word's body STYLEREF searches backward, then forward if none precedes it. */
export function bodyHeading(doc: PMNode, position: number, kind: HeadingField) {
  const matches = headingIndex(doc).filter(
    (h) => h.level === Number(kind.slice(-1)),
  );
  for (let i = matches.length - 1; i >= 0; i--)
    if (matches[i].pos <= position) return matches[i].text;
  return matches[0]?.text;
}
/** The printed running heading is the first matching heading on the sheet;
 * otherwise the nearest preceding one, then the first following one. */
export function withRunningHeadings(
  doc: PMNode,
  pages: FlowPage[],
  base: PageLayout,
): FlowPage[] {
  const active = (node: any): boolean =>
    (node?.type === "document_field" &&
      isHeadingField(node.attrs?.fieldKind)) ||
    !!node?.content?.some(active);
  if (
    !pages.some(
      (_, index) =>
        Object.values(
          pageFrame(pages, index, base).layout.runningMatter?.header || {},
        ).some(active) ||
        Object.values(
          pageFrame(pages, index, base).layout.runningMatter?.footer || {},
        ).some(active),
    )
  )
    return pages;
  const entries = headingIndex(doc)
    .map((h) => ({ ...h, page: physicalPageAtPosition(pages, h.pos) }))
    .filter((h) => h.page != null)
    .sort((a, b) => a.page! - b.page! || a.pos - b.pos);
  const byLevel = Array.from({ length: 6 }, (_, level) =>
      entries.filter((h) => h.level === level + 1),
    ),
    cursors = Array(6).fill(0);
  return pages.map((page, index) => {
    const values: Partial<Record<HeadingField, string>> = {};
    for (const kind of Object.keys(headingFieldLabels) as HeadingField[]) {
      const level = Number(kind.slice(-1)) - 1,
        matching = byLevel[level];
      while (
        cursors[level] < matching.length &&
        matching[cursors[level]].page! < index
      )
        cursors[level]++;
      const at = cursors[level],
        entry =
          matching[at]?.page === index
            ? matching[at]
            : matching[at - 1] || matching[0];
      const context = base.headingContext;
      const value =
        index === 0 && kind === "heading1" && context?.title != null
          ? context.title
          : matching[at]?.page === index
            ? matching[at].text
            : (matching[at - 1]?.text ??
              (kind === "heading1" ? context?.title : undefined) ??
              context?.before[kind] ??
              entry?.text ??
              context?.after[kind]);
      if (value != null) values[kind] = value;
    }
    const frame = pageFrame(pages, index, base);
    return {
      ...page,
      frame: { ...frame, layout: { ...frame.layout, runningHeadings: values } },
    };
  });
}
