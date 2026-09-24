import type { Node as PMNode } from "prosemirror-model";
import { projectText } from "./textProjection";
import {
  referenceSpans,
  type TextSpan,
  type TextHeading,
} from "./referenceSpans";

export type SpeechText = {
  text: string;
  offsets: number[];
  endOffsets: number[];
};
const inputs = new WeakMap<PMNode, Map<string, SpeechText>>();
const omitted = new WeakMap<PMNode, TextSpan[]>();

/** Spoken code points map back to their original UTF-16 start and end boundaries. */
export function speechText(
  doc: PMNode,
  start = 0,
  end?: number,
  readReferences = false,
): SpeechText {
  const projection = projectText(doc);
  const text = projection.text;
  end =
    end === undefined || end <= start
      ? text.length
      : Math.min(end, text.length);
  const key = `${start}:${end}:${readReferences}`;
  const cached = inputs.get(doc)?.get(key);
  if (cached) return cached;
  let spans = omitted.get(doc);
  if (!spans && !readReferences) {
    const marked: TextSpan[] = [],
      protectedSpans: TextSpan[] = [],
      superscripts: TextSpan[] = [],
      headings: TextHeading[] = [];
    const offset = (position: number) => {
      let low = 0,
        high = projection.map.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (projection.map[mid] < position) low = mid + 1;
        else high = mid;
      }
      return low;
    };
    doc.descendants((node, pos) => {
      const span = { start: offset(pos), end: offset(pos + node.nodeSize) };
      if (
        node.type.name === "code_block" ||
        node.marks.some((mark) => mark.type.name === "code")
      ) {
        protectedSpans.push(span);
        return false;
      }
      if (node.type.name === "heading")
        headings.push({
          ...span,
          text: node.textContent,
          level: node.attrs.level || 1,
        });
      if (node.isText && node.marks.some((mark) => mark.type.name === "link"))
        marked.push(span);
      if (
        node.isText &&
        node.marks.some((mark) => mark.type.name === "superscript") &&
        /^\d+(?:[,–-]\d+)*$/.test(node.text || "")
      )
        superscripts.push(span);
    });
    spans = referenceSpans(
      text,
      marked,
      protectedSpans,
      headings,
      superscripts,
    );
    omitted.set(doc, spans);
  }
  const filter =
    !readReferences &&
    spans?.some((span) => span.start < end! && span.end > start);
  const result: SpeechText = { text: "", offsets: [], endOffsets: [0] };
  const append = (char: string, from: number, to: number) => {
    result.text += char;
    result.offsets.push(from - start);
    result.endOffsets.push(to - start);
  };
  let pendingStart = -1,
    pendingEnd = 0,
    newlines = 0,
    skippedReference = false;
  const space = (from: number, to: number, char: string) => {
    if (pendingStart < 0) pendingStart = from;
    pendingEnd = to;
    if (char === "\n") newlines++;
  };
  let i = start,
    spanIndex = 0;
  while (i < end) {
    while (spans && spanIndex < spans.length && spans[spanIndex].end <= i)
      spanIndex++;
    const span = filter && spans?.[spanIndex];
    if (span && span.start <= i) {
      const to = Math.min(end, span.end);
      space(i, to, " ");
      skippedReference = true;
      i = to;
      continue;
    }
    const char = String.fromCodePoint(text.codePointAt(i)!);
    if (filter && /\s/u.test(char)) space(i, i + char.length, char);
    else {
      // A full stop after a citation need not repeat the sentence's own stop.
      if (skippedReference && char === "." && /[.!?]$/.test(result.text)) {
        i += char.length;
        continue;
      }
      if (pendingStart >= 0 && result.text) {
        if (newlines) {
          append("\n", pendingStart, pendingEnd);
          if (newlines > 1) append("\n", pendingEnd, pendingEnd);
        } else if (!/^[.,;:!?)}\]]$/.test(char) && !/[([{]$/.test(result.text))
          append(" ", pendingStart, pendingEnd);
      }
      pendingStart = -1;
      newlines = 0;
      skippedReference = false;
      append(char, i, i + char.length);
    }
    i += char.length;
  }
  // The terminal caret advances past any trailing bibliography as playback ends.
  result.offsets.push(end - start);
  let cache = inputs.get(doc);
  if (!cache) {
    cache = new Map();
    inputs.set(doc, cache);
  }
  if (cache.size >= 4) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}
