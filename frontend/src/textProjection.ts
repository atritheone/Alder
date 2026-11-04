import type { Node as PMNode } from "prosemirror-model";
import type { DocNode } from "./types";
export const deletedBlock=(node:DocNode)=> ((node.attrs?.revisionMove||node.attrs?.revisionBlock) as {kind?:string}|undefined)?.kind==='deletion';

export function documentText(node: DocNode): string {
  if(deletedBlock(node))return '';
  if (node.marks?.some((mark) => mark.type === "revision_deletion")) return "";
  if (node.type === "text") return node.text || "";
  if (["hardBreak", "hard_break"].includes(node.type)) return "\n";
  if (silent.has(node.type)) return "";
  if (node.type === "text_box")
    return "\n" + (node.content || []).map(documentText).join("") + "\n";
  return (node.content || [])
    .filter(child=>!deletedBlock(child))
    .map(documentText)
    .join(
      ["tableRow", "table_row"].includes(node.type)
        ? "\t"
        : separated.has(node.type)
          ? "\n"
          : "",
    );
}

/** Exact UTF-16 text projection used by backend/alder/models.document_text.
 * map[n] is the ProseMirror boundary at text offset n, including empty blocks.
 */
export type TextProjection = { text: string; map: Uint32Array };
const separated = new Set([
  "form_block",
  "bibliography",
  "table_of_contents",
  "doc",
  "blockquote",
  "bullet_list",
  "bulletList",
  "ordered_list",
  "orderedList",
  "list_item",
  "listItem",
  "table",
  "table_cell",
  "tableCell",
  "table_header",
  "tableHeader",
]);
const silent = new Set([
  "document_note",
  "revision_break",
  "comment_anchor",
  "bookmark",
  "bookmark_end",
  "index_entry",
  "image",
  "inline_image",
  "shape",
  "horizontal_rule",
  "horizontalRule",
  "page_break",
  "column_break",
  "section_break",
  "pageBreak",
]);

export type TextLanguageSpan = { start: number; end: number; language: string };
/** Language follows authored paragraph/style inheritance in the same UTF-16
 * projection as corrections. Generated wording is nonlinguistic (zxx). */
export function textLanguageSpans(
  document: DocNode,
  styles: ReadonlyMap<string, string>,
  language: string,
) {
  const spans: TextLanguageSpan[] = [];
  let offset = 0;
  const append = (length: number, language: string) => {
    if (!length) return;
    const last = spans.at(-1);
    if (last?.language === language && last.end === offset) last.end += length;
    else spans.push({ start: offset, end: offset + length, language });
    offset += length;
  };
  const visit = (node: DocNode, inherited: string) => {
    if(deletedBlock(node))return;
    if (
      node.marks?.some((mark) => mark.type === "revision_deletion") ||
      silent.has(node.type)
    )
      return;
    const language = String(
      node.attrs?.textLanguage ||
        styles.get(String(node.attrs?.styleId || "")) ||
        inherited,
    );
    if (["equation", "citation", "bibliography", "table_of_contents"].includes(node.type) || (node.type === "form_field" && ["checkbox", "date"].includes(node.attrs?.kind))) {
      append(documentText(node).length, "zxx");
      return;
    }
    if (node.type === "text") {
      append((node.text || "").length, language);
      return;
    }
    if (["hard_break", "hardBreak"].includes(node.type)) {
      append(1, language);
      return;
    }
    if (node.type === "text_box") append(1, language);
    node.content?.filter(child=>!deletedBlock(child)).forEach((child, i) => {
      if (
        i &&
        (separated.has(node.type) ||
          ["table_row", "tableRow"].includes(node.type))
      )
        append(1, language);
      visit(child, language);
    });
    if (node.type === "text_box") append(1, language);
  };
  visit(document, language);
  return spans;
}

/** Generated wording is not a proofreading correction target. Offsets remain
 * in the unmodified document projection used by analysis and selection. */
const generatedCache = new WeakMap<DocNode, { start: number; end: number }[]>();
export function generatedTextSpans(document: DocNode) {
  const cached = generatedCache.get(document);
  if (cached) return cached;
  const spans: { start: number; end: number }[] = [];
  let offset = 0;
  const visit = (node: DocNode) => {
    if(deletedBlock(node))return;
    if (
      node.marks?.some((mark) => mark.type === "revision_deletion") ||
      silent.has(node.type)
    )
      return;
    if (["equation", "citation", "bibliography", "table_of_contents"].includes(node.type) || (node.type === "form_field" && ["checkbox", "date"].includes(node.attrs?.kind))) {
      const end = offset + documentText(node).length;
      if (end > offset) spans.push({ start: offset, end });
      offset = end;
      return;
    }
    if (node.type === "text") {
      offset += (node.text || "").length;
      return;
    }
    if (["hard_break", "hardBreak"].includes(node.type)) {
      offset++;
      return;
    }
    if (node.type === "text_box") offset++;
    node.content?.filter(child=>!deletedBlock(child)).forEach((child, index) => {
      if (
        index &&
        (separated.has(node.type) ||
          ["table_row", "tableRow"].includes(node.type))
      )
        offset++;
      visit(child);
    });
    if (node.type === "text_box") offset++;
  };
  visit(document);
  generatedCache.set(document, spans);
  return spans;
}
export function intersectsTextSpans(
  spans: readonly { start: number; end: number }[],
  start: number,
  end: number,
) {
  let low = 0,
    high = spans.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (spans[middle].end <= start) low = middle + 1;
    else high = middle;
  }
  return !!spans[low] && spans[low].start < end;
}

// ProseMirror documents are immutable. Reuse their mapping across selection,
// highlighting and page updates instead of allocating one entry per character
// for every spoken word. Bound retention even when undo history holds old docs.
const projections = new Map<PMNode, TextProjection>();
type ProjectionRun = { at: number; position: number; linear: boolean };
const projectionRuns = new WeakMap<TextProjection, ProjectionRun[]>();

/** Source boundary without allocating a character-sized map. The packed map
 * remains available for consumers that need all boundaries at once. */
export function projectionPosition(projection: TextProjection, offset: number) {
  const runs = projectionRuns.get(projection);
  if (!runs) return projection.map[offset];
  let low = 0, high = runs.length;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (runs[middle].at <= offset) low = middle;
    else high = middle;
  }
  const run = runs[low];
  return run.position + (run.linear ? offset - run.at : 0);
}

export function projectionOffset(projection: TextProjection, position: number) {
  let low = 0, high = projection.text.length + 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (projectionPosition(projection, middle) < position) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function projectText(doc: PMNode): TextProjection {
  const cached = projections.get(doc);
  if (cached) return cached;
  // A paragraph's ordinary text maps linearly. Keep those runs compact so a
  // keystroke or caret move need not fill a buffer for the entire manuscript.
  const runs: ProjectionRun[] = [];
  const chunks: string[] = [];
  let at = 0;
  const boundary = (position: number, linear = false) => {
    if (runs.at(-1)?.at === at) runs.pop();
    runs.push({ at, position, linear });
  };
  function visit(node: PMNode, position: number, isRoot = false) {
    if((node.attrs.revisionMove||node.attrs.revisionBlock)?.kind==='deletion'){boundary(position+node.nodeSize);return;}
    if (node.marks.some((mark) => mark.type.name === "revision_deletion")) {
      boundary(position + node.nodeSize);
      return;
    }
    if (node.isText) {
      const text = node.text || "";
      chunks.push(text);
      boundary(position, true);
      at += text.length;
      return;
    }
    const kind = node.type.name;
    if (kind === "hard_break" || kind === "hardBreak") {
      chunks.push("\n");
      boundary(position);
      at++; boundary(position + node.nodeSize);
      return;
    }
    if (silent.has(kind)) {
      boundary(position + node.nodeSize);
      return;
    }
    const contentStart = isRoot ? 0 : position + 1;
    const separator =
      kind === "table_row" || kind === "tableRow"
        ? "\t"
        : separated.has(kind)
          ? "\n"
          : "";
    if (kind === "text_box") {
      chunks.push("\n");
      boundary(position); at++;
    }
    boundary(contentStart);
    let visible=0;
    node.forEach((child, offset) => {
      if((child.attrs.revisionMove||child.attrs.revisionBlock)?.kind==='deletion'){boundary(contentStart+offset+child.nodeSize);return;}
      if (visible++ && separator) {
        chunks.push(separator);
        at++;
      }
      // Adjacent inline children share a boundary with right affinity; an
      // empty/silent child replaces that boundary without adding wording.
      visit(child, contentStart + offset);
    });
    if (kind === "text_box") {
      chunks.push("\n");
      at++; boundary(position + node.nodeSize);
    }
  }
  visit(doc, 0, true);
  let packed: Uint32Array | undefined;
  const projection: TextProjection = {
    text: chunks.join(""),
    get map() {
      if (!packed) {
        packed = new Uint32Array(at + 1);
        runs.forEach((run, index) => {
          const end = runs[index + 1]?.at ?? at + 1;
          for (let i = run.at; i < end; i++) packed![i] = run.position + (run.linear ? i - run.at : 0);
        });
      }
      return packed;
    },
  };
  projectionRuns.set(projection, runs);
  if (projections.size >= 4)
    projections.delete(projections.keys().next().value!);
  projections.set(doc, projection);
  return projection;
}

function splitsSurrogate(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return false;
  const left = text.charCodeAt(offset - 1),
    right = text.charCodeAt(offset);
  return left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff;
}

export function selectionOffsets(doc: PMNode, from: number, to: number) {
  const projection = projectText(doc);
  const offset = (position: number) => Math.min(projectionOffset(projection, position), projection.text.length);
  return { start: offset(from), end: offset(to) };
}

export function projectedRange(
  doc: PMNode,
  start: number,
  end: number,
  expectedText?: string,
  existingProjection?: TextProjection,
): { from: number; to: number } {
  const projection = existingProjection || projectText(doc);
  if (expectedText !== undefined && projection.text !== expectedText)
    throw new RangeError(
      "This result refers to earlier text. Run the check again.",
    );
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end > projection.text.length ||
    splitsSurrogate(projection.text, start) ||
    splitsSurrogate(projection.text, end)
  ) {
    throw new RangeError(
      "This text range is no longer valid. Run the check again.",
    );
  }
  const from = projectionPosition(projection, start);
  let to = projectionPosition(projection, end);
  // One text boundary has right affinity in the cached projection. At the end
  // of a match use left affinity so a text-box boundary is never deleted along
  // with its last word, or included with the prose immediately before it.
  if (end > start) {
    const resolved = doc.resolve(to),
      before = resolved.nodeBefore;
    if (
      ["text_box", "form_field"].includes(resolved.parent.type.name) &&
      resolved.parentOffset === 0 &&
      from < resolved.before()
    )
      to = resolved.before();
    else if (before && ["text_box", "form_field"].includes(before.type.name) && from > to - before.nodeSize)
      to--;
  }
  // A zero-width bookmark at the end of a corrected word belongs after it,
  // rather than inside the replacement. Empty insertions retain right affinity.
  while (to > from) {
    const before = doc.resolve(to).nodeBefore;
    if (
      !before ||
      (!before.marks.some((mark) => mark.type.name === "revision_deletion") &&
        ![
          "bookmark",
          "bookmark_end",
          "index_entry",
          "document_note",
          "comment_anchor",
          "inline_image",
  "shape",
        ].includes(before.type.name))
    )
      break;
    to -= before.nodeSize;
  }
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < from ||
    to > doc.content.size
  )
    throw new RangeError("This text range is outside the current document.");
  return { from, to };
}

/** A caret offset counts inline atoms; visible words do not. */
export function wordAtPosition(doc: PMNode, position: number) {
  const resolved = doc.resolve(position);
  if (!resolved.parent.isTextblock && !["text_box", "form_field"].includes(resolved.parent.type.name))
    return null;
  const parent = resolved.parent,
    start = resolved.start();
  const projection = projectText(parent),
    offset = position - start;
  let low = 0,
    high = projection.map.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (projection.map[middle] < offset) low = middle + 1;
    else high = middle;
  }
  const left =
    projection.text.slice(0, low).match(/[\p{L}\p{N}\u2019'-]+$/u)?.[0] || "";
  const right =
    projection.text.slice(low).match(/^[\p{L}\p{N}\u2019'-]+/u)?.[0] || "";
  if (!left && !right) return null;
  // projectedRange expects a complete document. Apply the parent's mapping
  // directly and keep a trailing point destination outside the word.
  const from = start + projection.map[low - left.length];
  let to = start + projection.map[low + right.length];
  while (to > from) {
    const before = doc.resolve(to).nodeBefore;
    if (
      !before ||
      (!before.marks.some((mark) => mark.type.name === "revision_deletion") &&
        ![
          "bookmark",
          "bookmark_end",
          "comment_anchor",
          "inline_image",
  "shape",
        ].includes(before.type.name))
    )
      break;
    to -= before.nodeSize;
  }
  return { from, to, text: left + right };
}
