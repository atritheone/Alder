import type { NodeSpec, Node as PMNode } from "prosemirror-model";
import type { DocNode, Project } from "./types";
import { documentText } from "./textProjection";
import {
  citationStyles,
  stableCitationJSON,
  validCitationItems,
  type CitationStyle,
  type CitationItem,
  type CitationSource,
} from "./citationTypes";
import type { CitationInput, CitationOutput } from "./citationProcessor";
const fresh = () => "block_" + crypto.randomUUID();
export const citationSpec: NodeSpec = {
  inline: true,
  atom: true,
  group: "inline",
  content: "text*",
  marks: "",
  attrs: {
    blockId: { default: null },
    items: { default: [] },
    renderedStyle: { default: "apa" },
  },
  parseDOM: [
    {
      tag: "span[data-document-citation]",
      priority: 100,
      getAttrs: (dom) => {
        try {
          const attrs = JSON.parse(dom.getAttribute("data-document-citation")!);
          return validCitationItems(attrs.items)
            ? {
                items: attrs.items,
                renderedStyle: attrs.renderedStyle || "apa",
              }
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
      "data-document-citation": JSON.stringify({
        items: node.attrs.items,
        renderedStyle: node.attrs.renderedStyle,
      }),
      class: "document-citation",
      contenteditable: "false",
      title: "Citation. Double-click to edit.",
    },
    0,
  ],
};
export const bibliographySpec: NodeSpec = {
  group: "block",
  content: "paragraph+",
  atom: true,
  isolating: true,
  draggable: true,
  attrs: {
    blockId: { default: null },
    title: { default: "References" },
    entryStyle: { default: null },
    entryIds: { default: [] },
    renderedStyle: { default: "apa" },
  },
  parseDOM: [
    {
      tag: "div[data-document-bibliography]",
      priority: 100,
      getAttrs: (dom) => {
        try {
          const value = JSON.parse(
            dom.getAttribute("data-document-bibliography")!,
          );
          return validBibliography(value) ? value : false;
        } catch {
          return false;
        }
      },
    },
  ],
  toDOM: (node) => [
    "div",
    {
      "data-document-bibliography": JSON.stringify({
        ...node.attrs,
        blockId: null,
      }),
      class: "document-bibliography",
      contenteditable: "false",
      "aria-label": "Bibliography",
    },
    0,
  ],
};
export const validBibliography = (attrs: any) =>
  !!attrs &&
  typeof attrs.title === "string" &&
  attrs.title.length <= 200 &&
  (attrs.entryStyle == null ||
    (typeof attrs.entryStyle === "string" &&
      /^[A-Za-z0-9_.-]{1,128}$/.test(attrs.entryStyle))) &&
  Array.isArray(attrs.entryIds) &&
  attrs.entryIds.every(
    (ids: any) =>
      Array.isArray(ids) &&
      ids.every((id: any) => typeof id === "string" && id.length <= 128),
  ) &&
  Object.hasOwn(citationStyles, attrs.renderedStyle || "apa");
export function citationNodes(document: DocNode): DocNode[] {
  const output: DocNode[] = [];
  const visit = (node: DocNode) => {
    if (node.marks?.some((mark) => mark.type === "revision_deletion")) return;
    if (node.type === "citation") {
      output.push(node);
      return;
    }
    if (node.type === "bibliography") return;
    node.content?.forEach(visit);
  };
  visit(document);
  return output;
}
export function selectedCitation(doc: PMNode, from: number, to = from) {
  let found: { node: PMNode; pos: number } | undefined;
  doc.nodesBetween(
    Math.max(0, from - 1),
    Math.min(doc.content.size, to + 1),
    (node, pos) => {
      if (
        node.type.name === "citation" &&
        pos <= to &&
        pos + node.nodeSize >= from
      ) {
        found = { node, pos };
        return false;
      }
    },
  );
  return found;
}
export function citationInput(
  documents: DocNode[],
  style: CitationStyle,
): CitationInput {
  return {
    style,
    citations: documents.flatMap((document) =>
      citationNodes(document).map((node) => ({
        id: node.attrs!.blockId,
        items: node.attrs!.items,
      })),
    ),
  };
}
export function formatCitations(
  input: CitationInput,
  signal?: AbortSignal,
): Promise<CitationOutput> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Cancelled", "AbortError"));
      return;
    }
    const worker = new Worker(new URL("./citationWorker.ts", import.meta.url), {
      type: "module",
    });
    const end = () => {
      clearTimeout(timer);
      worker.terminate();
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      end();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      end();
      reject(
        new Error(
          "Citation formatting took too long. The document has not been changed.",
        ),
      );
    }, 30000);
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event) => {
      end();
      event.data.error
        ? reject(new Error(event.data.error))
        : resolve(event.data.result);
    };
    worker.onerror = () => {
      end();
      reject(new Error("The local citation processor could not start."));
    };
    worker.postMessage(input);
  });
}
/** Interpret only generated CSL typography; no scripts, arbitrary style, remote
 * images or event handlers from bibliographic metadata enter the editor. */
export function citationInline(html: string): DocNode[] {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const walk = (
    node: Node,
    marks: NonNullable<DocNode["marks"]> = [],
  ): DocNode[] => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent || "";
      if (/^[\t\r\n ]*$/.test(value) && /[\r\n]/.test(value)) return [];
      const text = value.replace(/[\t\r\n ]+/g, " ");
      return text
        ? [{ type: "text", text, ...(marks.length ? { marks } : {}) }]
        : [];
    }
    if (
      !(node instanceof HTMLElement) ||
      ["SCRIPT", "STYLE", "IFRAME", "IMG", "OBJECT"].includes(node.tagName)
    )
      return [];
    const next = [...marks];
    if (
      node.tagName === "I" ||
      node.tagName === "EM" ||
      node.style.fontStyle === "italic"
    )
      next.push({ type: "em" });
    if (
      node.tagName === "B" ||
      node.tagName === "STRONG" ||
      node.style.fontWeight === "bold"
    )
      next.push({ type: "strong" });
    if (node.tagName === "SUP") next.push({ type: "superscript" });
    if (node.tagName === "SUB") next.push({ type: "subscript" });
    if (
      node.tagName === "A" &&
      /^(https?:|mailto:)/i.test(node.getAttribute("href") || "")
    )
      next.push({
        type: "link",
        attrs: { href: node.getAttribute("href"), title: null },
      });
    const content = Array.from(node.childNodes).flatMap((child) =>
      walk(child, next),
    );
    if (node.classList.contains("csl-left-margin"))
      content.push({ type: "text", text: "\t" });
    return content;
  };
  const result = Array.from(parsed.body.childNodes).flatMap((child) =>
    walk(child),
  );
  if (result[0]?.type === "text") result[0].text = result[0].text!.trimStart();
  if (result.at(-1)?.type === "text")
    result.at(-1)!.text = result.at(-1)!.text!.trimEnd();
  return result.filter((node) => node.type !== "text" || node.text);
}
export function applyCitationOutput(
  document: DocNode,
  output: CitationOutput,
  style: CitationStyle,
): DocNode {
  if (document.type === "citation") {
    const html = output.citations[document.attrs!.blockId];
    if (html == null) return document;
    // Citation nodes intentionally expose a single immutable textual result.
    const text = documentText({ type: "doc", content: citationInline(html) });
    const next = {
      ...document,
      attrs: { ...document.attrs, renderedStyle: style },
      content: text ? [{ type: "text", text }] : [],
    };
    return stableCitationJSON(next) === stableCitationJSON(document)
      ? document
      : next;
  }
  if (document.type === "bibliography") {
    const attrs = document.attrs!,
      previous = new Map<string, DocNode>();
    (attrs.entryIds || []).forEach((ids: string[], index: number) => {
      const node = document.content?.[index + (attrs.title ? 1 : 0)];
      if (node) previous.set(ids.join("\u0000"), node);
    });
    const content: DocNode[] = attrs.title
      ? [
          {
            type: "paragraph",
            attrs: document.content?.[0]?.attrs || {
              blockId: fresh(),
              keepWithNext: true,
            },
            content: [
              { type: "text", text: attrs.title, marks: [{ type: "strong" }] },
            ],
          },
        ]
      : [];
    for (const item of output.bibliography) {
      const old = previous.get(item.ids.join("\u0000")),
        defaults = {
          leftIndent: output.hangingIndent || output.secondFieldAlign ? 18 : 0,
          firstLineIndent:
            output.hangingIndent || output.secondFieldAlign ? -18 : 0,
          tabStops: output.secondFieldAlign
            ? [{ position: 18, align: "left", leader: "none" }]
            : null,
          lineHeight: output.lineSpacing,
          spaceBefore: 0,
          spaceAfter: output.entrySpacing * 12,
        };
      const properties = old?.attrs
        ? {
            ...old.attrs,
            ...(attrs.renderedStyle !== style && !attrs.entryStyle
              ? defaults
              : {}),
          }
        : {
            blockId: fresh(),
            styleId: attrs.entryStyle,
            ...(attrs.entryStyle ? {} : defaults),
          };
      content.push({
        type: "paragraph",
        attrs: properties,
        content: citationInline(item.html),
      });
    }
    if (!output.bibliography.length)
      content.push({
        type: "paragraph",
        content: [{ type: "text", text: "No cited sources." }],
      });
    const next = {
      ...document,
      attrs: {
        ...attrs,
        renderedStyle: style,
        entryIds: output.bibliography.map((item) => item.ids),
      },
      content,
    };
    return stableCitationJSON(next) === stableCitationJSON(document)
      ? document
      : next;
  }
  if (!document.content) return document;
  const content = document.content.map((node) =>
    applyCitationOutput(node, output, style),
  );
  return content.every((node, i) => node === document.content![i])
    ? document
    : { ...document, content };
}
export function documentCitationSources(document: DocNode) {
  const values = new Map<string, CitationSource>();
  for (const node of citationNodes(document))
    for (const item of node.attrs!.items as CitationItem[])
      values.set(item.source.id, item.source);
  return [...values.values()];
}
export function replaceCitationSources(
  document: DocNode,
  sources: Map<string, CitationSource>,
): DocNode {
  if (document.type === "citation")
    return {
      ...document,
      attrs: {
        ...document.attrs,
        items: (document.attrs!.items as CitationItem[]).map((item) => ({
          ...item,
          source: sources.get(item.source.id) || item.source,
        })),
      },
    };
  return document.content
    ? {
        ...document,
        content: document.content.map((node) =>
          replaceCitationSources(node, sources),
        ),
      }
    : document;
}
export async function refreshProjectCitations(
  project: Project,
  signal?: AbortSignal,
) {
  const style: CitationStyle = project.settings.citationStyle || "apa";
  const chapters = project.book?.chapters || [],
    included = chapters.filter((chapter) => chapter.include !== false);
  const groups = [
    included,
    ...chapters
      .filter((chapter) => chapter.include === false)
      .map((chapter) => [chapter]),
    ...project.clips.flatMap((clip) => [
      [clip],
      ...clip.variants.map((variant) => [variant]),
    ]),
  ];
  for (const group of groups) {
    const docs = group.map((item) => item.document),
      input = citationInput(docs, style);
    if (
      !input.citations.length &&
      !docs.some((doc) => JSON.stringify(doc).includes('"bibliography"'))
    )
      continue;
    const output = await formatCitations(input, signal);
    group.forEach((item) => {
      item.document = applyCitationOutput(item.document, output, style);
      item.text = documentText(item.document);
    });
  }
  return project;
}
