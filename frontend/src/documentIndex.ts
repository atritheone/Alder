import {
  identifiedGeneratedContents,
  generatedLabelAttrs,
} from "./generatedIdentities";
import type { NodeSpec, Node as PMNode } from "prosemirror-model";
import { TextSelection, type Command } from "prosemirror-state";
import { closeHistory } from "prosemirror-history";
import type { DocNode } from "./types";
import type { ContentsOptions } from "./documentContents";
import { documentText } from "./textProjection";
import { documentBookmarks } from "./documentBookmarks";
import { indexCollator } from "./indexCollation";

export type IndexEntry = {
  terms: string[];
  see?: string | null;
  rangeId?: string | null;
  indexGroup?: string | null;
  sortTerms?: string[] | null;
};
export const indexGroup = (value?: string | null) =>
  (value || "I").toUpperCase();
export const validIndexGroup = (value: unknown) =>
  value == null || (typeof value === "string" && /^[A-Za-z]$/.test(value));
const indexKey = (value: { terms: string[]; sortTerms?: string[] | null }) =>
  JSON.stringify([
    value.terms,
    value.sortTerms?.some(Boolean) ? value.sortTerms : null,
  ]);
export const validIndexEntry = (value: unknown): value is IndexEntry => {
  if (!value || typeof value !== "object") return false;
  const entry = value as IndexEntry;
  return (
    validIndexGroup(entry.indexGroup) &&
    (entry.sortTerms == null ||
      (Array.isArray(entry.sortTerms) &&
        entry.sortTerms.length <= entry.terms?.length &&
        entry.sortTerms.every(
          (term) =>
            typeof term === "string" &&
            term.length <= 200 &&
            term.trim() === term &&
            !/[\u0000-\u001f\u007f]/u.test(term),
        ))) &&
    Array.isArray(entry.terms) &&
    entry.terms.length >= 1 &&
    entry.terms.length <= 3 &&
    entry.terms.every(
      (term) =>
        typeof term === "string" &&
        term.length <= 200 &&
        term.trim() === term &&
        !!term &&
        !/[\u0000-\u001f\u007f]/u.test(term),
    ) &&
    (entry.rangeId == null ||
      (typeof entry.rangeId === "string" &&
        /^[A-Za-z0-9_.-]{1,128}$/.test(entry.rangeId))) &&
    !(entry.rangeId && entry.see) &&
    (entry.see == null ||
      (typeof entry.see === "string" &&
        entry.see.length <= 200 &&
        !/[\u0000-\u001f\u007f]/u.test(entry.see)))
  );
};
const identities = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= 100000 &&
  value.every(
    (id) => typeof id === "string" && /^[A-Za-z0-9_.-]{1,128}$/.test(id),
  );
export const validIndexReference = (value: any) => {
  const ids = value?.targetIds,
    unresolved = value?.unresolved;
  return (
    validIndexEntry(value) &&
    identities(ids) &&
    (unresolved == null || typeof unresolved === "boolean")
  );
};
export const indexEntrySpec: NodeSpec = {
  inline: true,
  group: "inline",
  atom: true,
  selectable: false,
  marks: "",
  attrs: {
    blockId: { default: null },
    terms: { default: [] },
    see: { default: null },
    rangeId: { default: null },
    indexGroup: { default: null },
    sortTerms: { default: null },
  },
  parseDOM: [
    {
      tag: "span[data-index-entry]",
      getAttrs: (element) => {
        try {
          const value = JSON.parse(element.getAttribute("data-index-entry")!);
          return validIndexEntry(value)
            ? { ...value, blockId: element.getAttribute("data-index-id") }
            : false;
        } catch {
          return false;
        }
      },
    },
  ],
  toDOM: (node) => [
    "span",
    {
      "data-index-entry": JSON.stringify({
        terms: node.attrs.terms,
        see: node.attrs.see,
        rangeId: node.attrs.rangeId,
        indexGroup: node.attrs.indexGroup,
        sortTerms: node.attrs.sortTerms,
      }),
      "data-index-id": node.attrs.blockId,
      class: "document-index-entry",
      title: "Index: " + node.attrs.terms.join(" › "),
      "aria-label": "Index: " + node.attrs.terms.join(" › "),
      contenteditable: "false",
    },
  ],
};
export const indexReferenceSpec: NodeSpec = {
  inline: true,
  group: "inline",
  atom: true,
  content: "text*",
  attrs: {
    blockId: { default: null },
    terms: { default: [] },
    targetIds: { default: [] },
    sortTerms: { default: null },
    unresolved: { default: false },
  },
  parseDOM: [
    {
      tag: "span[data-index-reference]",
      getAttrs: (element) => {
        try {
          const value = JSON.parse(
            element.getAttribute("data-index-reference")!,
          );
          return validIndexReference(value) ? value : false;
        } catch {
          return false;
        }
      },
    },
  ],
  toDOM: (node) => [
    "span",
    {
      "data-index-reference": JSON.stringify({
        terms: node.attrs.terms,
        targetIds: node.attrs.targetIds,
        sortTerms: node.attrs.sortTerms,
        unresolved: node.attrs.unresolved,
      }),
      "data-cross-reference": node.attrs.targetIds[0] || null,
      class: "document-reference",
      contenteditable: "false",
      title: node.attrs.unresolved
        ? "Some index entries are unavailable. Update fields after correcting them."
        : "Index pages. Ctrl-click (Command-click on Mac) to go to the first entry.",
    },
    0,
  ],
};
export function indexEntries(doc: PMNode) {
  const entries: {
    pos: number;
    id: string;
    terms: string[];
    see: string | null;
    rangeId: string | null;
    indexGroup: string | null;
    sortTerms: string[] | null;
    context: string;
  }[] = [];
  doc.descendants((node, pos, parent) => {
    if ((node.attrs.revisionMove || node.attrs.revisionBlock)?.kind === "deletion" || node.marks.some(mark => mark.type.name === "revision_deletion")) return false;
    if (node.type.name === "table_of_contents") return false;
    if (node.type.name === "index_entry")
      entries.push({
        pos,
        id: node.attrs.blockId,
        terms: node.attrs.terms,
        see: node.attrs.see,
        rangeId: node.attrs.rangeId,
        indexGroup: node.attrs.indexGroup,
        sortTerms: node.attrs.sortTerms,
        context: parent?.textContent.slice(0, 100) || "",
      });
  });
  return entries;
}
export function setIndexEntry(value: IndexEntry | null, id?: string): Command {
  return (state, dispatch) => {
    if (value && !validIndexEntry(value)) return false;
    if (
      value?.rangeId &&
      !documentBookmarks(state.doc).some(
        (b) => b.id === value.rangeId && b.end != null && !b.incomplete,
      )
    )
      return false;
    const existing = id
      ? indexEntries(state.doc).find((entry) => entry.id === id)
      : undefined;
    if (id && !existing) return false;
    if (!existing && (!value || !state.selection.$to.parent.inlineContent))
      return false;
    if (dispatch) {
      const tr = closeHistory(state.tr);
      if (existing) {
        if (!value) tr.delete(existing.pos, existing.pos + 1);
        else
          tr.setNodeMarkup(existing.pos, undefined, {
            blockId: existing.id,
            ...value,
          });
      } else {
        const pos = state.selection.to;
        tr.insert(
          pos,
          state.schema.nodes.index_entry.create({
            blockId: "block_" + crypto.randomUUID(),
            ...value,
          }),
        );
        tr.setSelection(
          TextSelection.create(
            tr.doc,
            state.selection.from,
            state.selection.to,
          ),
        );
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}
export type IndexSource = {
  id: string;
  terms: string[];
  see?: string | null;
  chapter?: string;
  indexGroup?: string | null;
  sortTerms?: string[] | null;
};
type IndexTree = Map<
  string,
  {
    term: string;
    sort: string;
    children: IndexTree;
    ids: string[];
    see: Set<string>;
  }
>;
export function indexGroups(
  entries: IndexSource[],
  groupName?: string | null,
  useSortText = true,
  language?: string | null,
) {
  const collator = indexCollator(language);
  const tree: IndexTree = new Map();
  for (const entry of entries) {
    if (
      !validIndexEntry(entry) ||
      indexGroup(entry.indexGroup) !== indexGroup(groupName)
    )
      continue;
    let branch = tree;
    for (let i = 0; i < entry.terms.length; i++) {
      const term = entry.terms[i],
        sort = (useSortText && entry.sortTerms?.[i]) || term,
        key = JSON.stringify([term, sort]);
      if (!branch.has(key))
        branch.set(key, {
          term,
          sort,
          children: new Map(),
          ids: [],
          see: new Set(),
        });
      const group = branch.get(key)!;
      if (i === entry.terms.length - 1) {
        if (entry.see) group.see.add(entry.see);
        else group.ids.push(entry.id);
      }
      branch = group.children;
    }
  }
  const result: {
    terms: string[];
    ids: string[];
    see: string[];
    sortTerms?: string[];
  }[] = [];
  const visit = (branch: typeof tree, parent: string[], sorts: string[]) => {
    for (const group of [...branch.values()].sort((a, b) => {
      return collator.compare(a.sort, b.sort) || collator.compare(a.term, b.term) ||
        (a.term < b.term ? -1 : a.term > b.term ? 1 : a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0);
    })) {
      const terms = [...parent, group.term],
        sortTerms = [...sorts, group.sort === group.term ? "" : group.sort];
      result.push({
        terms,
        ids: group.ids,
        see: [...group.see],
        ...(sortTerms.some(Boolean) ? { sortTerms } : {}),
      });
      visit(group.children, terms, sortTerms);
    }
  };
  visit(tree, [], []);
  return result;
}
export function refreshedIndex(node: DocNode, entries: IndexSource[]): DocNode {
  const options = node.attrs as ContentsOptions,
    previous = new Map<string, DocNode>();
  for (const paragraph of node.content || []) {
    const reference = paragraph.content?.find(
      (child) => child.type === "index_reference",
    );
    if (reference)
      previous.set(indexKey(reference.attrs as IndexEntry), paragraph);
  }
  const fallback = { ...previous.values().next().value?.attrs };
  delete fallback.blockId;
  const content: DocNode[] = options.title
    ? [
        {
          type: "paragraph",
          attrs: { ...generatedLabelAttrs(node, true), keepWithNext: true },
          content: [
            { type: "text", text: options.title, marks: [{ type: "strong" }] },
          ],
        },
      ]
    : [];
  for (const group of indexGroups(
    entries,
    options.indexGroup,
    options.useSortText !== false,
    options.indexLanguage,
  )) {
    const prior = previous.get(indexKey(group)),
      old = prior?.content?.find((child) => child.type === "index_reference");
    content.push({
      type: "paragraph",
      attrs: {
        ...(prior?.attrs || fallback),
        styleId: options.entryStyle,
        leftIndent: (group.terms.length - 1) * 12,
        keepWithNext: false,
        headingNumbered: false,
      },
      content: [
        { type: "text", text: group.terms.at(-1)! },
        ...(group.ids.length && options.pageNumbers !== false
          ? [{ type: "text", text: ", " }]
          : []),
        {
          type: "index_reference",
          attrs: {
            blockId: old?.attrs?.blockId ?? null,
            terms: group.terms,
            sortTerms: group.sortTerms || null,
            targetIds: options.pageNumbers === false ? [] : group.ids,
            unresolved: old?.attrs?.unresolved || false,
          },
          content:
            group.ids.length && options.pageNumbers !== false
              ? [
                  {
                    type: "text",
                    text:
                      documentText(old || { type: "text", text: "—" }) || "—",
                  },
                ]
              : [],
        },
        ...(group.see.length
          ? [
              {
                type: "text",
                text: ". " + group.see.join("; "),
                marks: [{ type: "em" }],
              },
            ]
          : []),
      ],
    });
  }
  if (content.length === (options.title ? 1 : 0))
    content.push({
      type: "paragraph",
      attrs: generatedLabelAttrs(node, false),
      content: [{ type: "text", text: "No index entries available." }],
    });
  const next = identifiedGeneratedContents({ ...node, content });
  return JSON.stringify(next) === JSON.stringify(node) ? node : next;
}
export function indexPageText(
  ids: string[],
  references: Record<string, string>,
) {
  return [
    ...new Set(
      ids
        .map((id) => references[id])
        .filter((value): value is string => value != null),
    ),
  ].join(", ");
}
