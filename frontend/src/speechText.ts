import type { Node as PMNode } from "prosemirror-model";
import { projectText } from "./textProjection";

export type SpeechText = { text: string; offsets: number[] };
const inputs = new WeakMap<PMNode, Map<string, SpeechText>>();
const omitted = new WeakMap<PMNode, { start: number; end: number }[]>();

/** Spoken input plus source UTF-16 boundaries, one per spoken code point. */
export function speechText(
  doc: PMNode,
  start = 0,
  end?: number,
  readLinks = false,
): SpeechText {
  const projection = projectText(doc);
  const text = projection.text;
  end =
    end === undefined || end <= start
      ? text.length
      : Math.min(end, text.length);
  const key = `${start}:${end}:${readLinks}`;
  const cached = inputs.get(doc)?.get(key);
  if (cached) return cached;
  let spans = omitted.get(doc);
  if (!spans) {
    spans = [];
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
      if (node.isText && node.marks.some((mark) => mark.type.name === "link"))
        spans!.push({ start: offset(pos), end: offset(pos + node.nodeSize) });
    });
    // Imported formats may expose a URL as ordinary text rather than a mark.
    for (const match of text.matchAll(
      /(?:https?:\/\/|www\.)[^\s<>\[\]{}]+/gi,
    )) {
      const value = match[0].replace(/[.,;:!?)}]+$/, "");
      spans.push({ start: match.index!, end: match.index! + value.length });
    }
    spans.sort((a, b) => a.start - b.start);
    const merged: typeof spans = [];
    for (const span of spans) {
      const previous = merged.at(-1);
      if (previous && !text.slice(previous.end, span.start).trim())
        previous.end = Math.max(previous.end, span.end);
      else merged.push({ ...span });
    }
    for (const span of merged) {
      // Remove enclosing brackets only when they contain no other wording.
      while (true) {
        let a = span.start,
          b = span.end;
        while (a > 0 && /[ \t]/.test(text[a - 1])) a--;
        while (b < text.length && /[ \t]/.test(text[b])) b++;
        const close = (
          { "(": ")", "[": "]", "{": "}" } as Record<string, string>
        )[text[a - 1]];
        if (!close || text[b] !== close) break;
        span.start = a - 1;
        span.end = b + 1;
      }
    }
    spans = merged;
    omitted.set(doc, spans);
  }
  const result: SpeechText = { text: "", offsets: [0] };
  let i = start,
    spanIndex = 0;
  while (i < end) {
    while (spanIndex < spans.length && spans[spanIndex].end <= i) spanIndex++;
    const span = !readLinks && spans[spanIndex];
    if (span && span.start <= i) {
      i = Math.min(end, span.end);
      result.text += " ";
      result.offsets.push(i - start);
    } else {
      const char = String.fromCodePoint(text.codePointAt(i)!);
      result.text += char;
      i += char.length;
      result.offsets.push(i - start);
    }
  }
  let cache = inputs.get(doc);
  if (!cache) {
    cache = new Map();
    inputs.set(doc, cache);
  }
  if (cache.size >= 4) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}
