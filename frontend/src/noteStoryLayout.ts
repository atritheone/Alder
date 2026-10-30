import type { Schema } from "prosemirror-model";
import type { DocNode, NamedStyle } from "./types";
import { resolveStyles } from "./styleResolution";
import type { NoteLine } from "./footnoteLayout";
import { renderRunningStory } from "./runningStoryLayout";
import { runningImageVersion } from "./runningImages";
import {documentText} from './textProjection';
import {
  indexNoteParagraphs,
  measureRichNoteLines,
  type MeasuredNoteLines,
} from "./richNoteLayout";

let cache = new WeakMap<DocNode, Map<string, MeasuredNoteLines>>();
if (typeof document !== "undefined")
  document.fonts?.addEventListener("loadingdone", () => {
    cache = new WeakMap();
  });
/** Measure a paragraph/image note once at print scale. Positioned word runs
 * retain justification and mixed character formatting without keeping a copy
 * of the entire note in every line/page fragment. */
export function measureNoteLines(
  source: DocNode,
  number: string,
  width: number,
  fontFamily: string,
  schema: Schema,
  styles: NamedStyle[] = [],
  maximum = Infinity,
  from = 0,
  continued = false,
): MeasuredNoteLines {
  if (maximum <= 0)
    throw new Error(
      "The page is too short for a note. Increase its height or reduce its margins.",
    );
  const key = JSON.stringify([
    number,
    width,
    fontFamily,
    styles,
    runningImageVersion,
    maximum,
    from,
    continued,
  ]);
  let versions = cache.get(source);
  const cached = versions?.get(key);
  if (cached) return cached;
  const resolved = resolveStyles(styles);
  const prepare = (node: DocNode): DocNode => ({
    ...node,
    attrs: {
      ...(node.type === "paragraph"
        ? { fontSize: 9, lineHeight: 1.2, spaceBefore: 0, spaceAfter: 3 }
        : {}),
      ...resolved.get(node.attrs?.styleId),
      ...Object.fromEntries(
        Object.entries(node.attrs || {}).filter(([, v]) => v != null),
      ),
    },
    marks: node.marks?.map((mark) =>
      mark.type === "text_style"
        ? {
            ...mark,
            attrs: {
              ...resolved.get(mark.attrs?.styleId),
              ...Object.fromEntries(
                Object.entries(mark.attrs || {}).filter(([, v]) => v != null),
              ),
            },
          }
        : mark,
    ),
    content: node.content?.map(prepare),
  });
  let remainder=source;
  if(continued){
    if(source.content?.some(p=>p.type!=='paragraph'||p.content?.some(c=>!['text','hard_break'].includes(c.type))))
      throw new Error('A footnote containing lists, tables or pictures cannot continue across different page widths yet. Keep the section text widths equal before publishing.');
    let position=0;
    const content:DocNode[]=[];
    for(const paragraph of source.content||[]){
      const length=documentText(paragraph).length;
      if(position+length>=from){
        let skip=Math.max(0,from-position);
        const children:DocNode[]=[];
        for(const child of paragraph.content||[]){
          const size=documentText(child).length;
          if(skip>=size && skip>0){skip-=size;continue;}
          children.push(skip&&child.type==='text'?{...child,text:child.text!.slice(skip)}:child);skip=0;
        }
        content.push({...paragraph,attrs:{...paragraph.attrs,...(from>position||from===0?{firstLineIndent:0,spaceBefore:0}:{})},content:children});
      }
      position+=length+1;
    }
    remainder={...source,content};
  }
  const body = prepare(remainder);
  const separateLabel = body.content![0].type !== "paragraph";
  if (separateLabel)
    body.content!.unshift({
      type: "paragraph",
      attrs: { fontSize: 9, lineHeight: 1.2, spaceBefore: 0, spaceAfter: 3 },
    });
  if(!continued)body.content![0].content = [
    { type: "text", text: number + " " },
    ...(body.content![0].content || []),
  ];
  const rich = body.content!.some((node) =>
    ["table", "bullet_list", "ordered_list"].includes(node.type),
  );
  const offsets = rich
    ? indexNoteParagraphs(body, number.length + 1 + (separateLabel ? 1 : 0))
    : null;
  const host = document.createElement("div");
  host.dataset.runningStory = "note-measurement";
  host.style.cssText = `position:fixed;left:-20000px;top:0;visibility:hidden;pointer-events:none;width:${width}px;font-size:9pt;line-height:1.2;white-space:pre-wrap;overflow-wrap:break-word;zoom:1`;
  host.style.fontFamily = fontFamily;
  renderRunningStory(host, schema.nodeFromJSON(body));
  document.body.append(host);
  try {
    if (offsets) {
      const result = measureRichNoteLines(host, offsets, width, maximum);
      if (!versions) {
        versions = new Map();
        cache.set(source, versions);
      }
      if (versions.size >= 4) versions.delete(versions.keys().next().value!);
      versions.set(key, result);
      return result;
    }
    const origin = host.getBoundingClientRect(),
      scale = origin.width / width;
    type Line = { top: number; bottom: number; parts: string[]; sourceFrom?:number };
    const lines: Line[] = [];
    let textOffset = continued ? from : -(number.length + 1) - (separateLabel ? 1 : 0);
    for (const paragraph of host.children) {
      const paragraphStart=textOffset;
      const box = paragraph.getBoundingClientRect(),
        css = getComputedStyle(paragraph),
        leading = parseFloat(css.lineHeight) || parseFloat(css.fontSize) * 1.2;
      const paragraphLines: Line[] = [];
      const walker = document.createTreeWalker(
        paragraph,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
        {
          acceptNode: (node) =>
            node.nodeType === Node.TEXT_NODE ||
            ["BR", "IMG"].includes((node as Element).tagName)
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_SKIP,
        },
      );
      while (walker.nextNode()) {
        if (
          walker.currentNode.nodeType === Node.ELEMENT_NODE &&
          (walker.currentNode as Element).tagName === "IMG"
        ) {
          const source = walker.currentNode as HTMLImageElement,
            bounds = source.getBoundingClientRect();
          if (bounds.width > 0 && bounds.height > 0) {
            let line = paragraphLines.at(-1);
            if (
              !line ||
              bounds.top >= line.bottom - 0.5 ||
              bounds.bottom <= line.top + 0.5
            ) {
              line = { top: bounds.top, bottom: bounds.bottom, parts: [] };
              paragraphLines.push(line);
            }
            line.top = Math.min(line.top, bounds.top);
            line.bottom = Math.max(line.bottom, bounds.bottom);
            const copy = source.cloneNode(true) as HTMLImageElement;
            copy.removeAttribute("data-block-id");
            copy.removeAttribute("id");
            copy.style.cssText = `position:absolute;left:${(bounds.left - origin.left) / scale}px;top:${(bounds.top - box.top) / scale}px;width:${bounds.width / scale}px;height:${bounds.height / scale}px;max-width:none`;
            line.parts.push(copy.outerHTML);
          }
          continue;
        }
        if (walker.currentNode.nodeType !== Node.TEXT_NODE) {
          textOffset++;
          continue;
        }
        const text = walker.currentNode as Text;
        if (!text.length) continue;
        const range = document.createRange(),
          style = getComputedStyle(text.parentElement!);
        const rect = (from: number, to: number) => {
          range.setStart(text, from);
          range.setEnd(text, to);
          return range.getBoundingClientRect();
        };
        let from = 0;
        while (from < text.length) {
          const first = rect(from, from + 1);
          let lo = from + 1,
            hi = text.length;
          while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2),
              last = rect(mid - 1, mid);
            if (last.top < first.bottom - 0.5 && last.bottom > first.top + 0.5)
              lo = mid;
            else hi = mid - 1;
          }
          const to = lo;
          for (const match of text.data.slice(from, to).matchAll(/\S+|\s+/gu)) {
            const start = from + match.index!,
              bounds = rect(start, start + match[0].length);
            if (bounds.width <= 0.1) continue;
            let line = paragraphLines.at(-1);
            if (
              !line ||
              bounds.top >= line.bottom - 0.5 ||
              bounds.bottom <= line.top + 0.5
            ) {
              line = { top: bounds.top, bottom: bounds.bottom, parts: [] };
              paragraphLines.push(line);
            }
            line.top = Math.min(line.top, bounds.top);
            line.bottom = Math.max(line.bottom, bounds.bottom);
            const span = document.createElement("span");
            line.sourceFrom=Math.min(line.sourceFrom??Infinity,Math.max(0,textOffset+start));
            const language = text.parentElement
              ?.closest("[lang]")
              ?.getAttribute("lang");
            if (language) span.lang = language;
            span.textContent = match[0];
            if (textOffset + start >= 0) {
              span.dataset.noteFrom = String(textOffset + start);
              span.dataset.noteTo = String(
                textOffset + start + match[0].length,
              );
            }
            for (const prop of [
              "font-family",
              "font-size",
              "font-weight",
              "font-style",
              "font-variant",
              "letter-spacing",
              "word-spacing",
              "color",
              "background-color",
              "text-decoration",
            ])
              span.style.setProperty(prop, style.getPropertyValue(prop));
            span.style.cssText += `;position:absolute;left:${(bounds.left - origin.left) / scale}px;top:${(bounds.top - box.top) / scale}px;line-height:${bounds.height / scale}px;white-space:pre;`;
            if (text.parentElement?.classList.contains("alder-tab")) {
              span.className = "alder-tab";
              span.style.width = `${bounds.width / scale}px`;
              for (const prop of [
                "background-image",
                "background-size",
                "--alder-tab-leader-y",
                "tab-size",
              ])
                span.style.setProperty(prop, style.getPropertyValue(prop));
            }
            const anchor =
              text.parentElement?.closest<HTMLAnchorElement>("a[href]");
            if (
              anchor &&
              /^(https?:|mailto:|#)/i.test(anchor.getAttribute("href") || "")
            ) {
              const link = document.createElement("a");
              link.setAttribute("href", anchor.getAttribute("href")!);
              link.append(span);
              line.parts.push(link.outerHTML);
            } else line.parts.push(span.outerHTML);
          }
          from = to;
        }
        textOffset += text.length;
      }
      if (!paragraphLines.length)
        paragraphLines.push({
          top: box.top,
          bottom: box.top + leading * scale,
          parts: [],
          sourceFrom:Math.max(0,paragraphStart),
        });
      const before = Math.max(0, parseFloat(css.marginTop) || 0),
        after = Math.max(0, parseFloat(css.marginBottom) || 0),
        paddingTop = Math.max(0, parseFloat(css.paddingTop) || 0);
      for (let i = 0; i < paragraphLines.length; i++) {
        const line = paragraphLines[i],
          next = paragraphLines[i + 1];
        const top = (line.top - box.top) / scale,
          height = next
            ? (next.top - line.top) / scale
            : Math.max(leading, (box.bottom - line.top) / scale) + after;
        const firstSpace = i === 0 ? before + paddingTop : 0,
          lineHeight = height + firstSpace,
          paint = document.createElement("div"),
          border =
            css.outlineStyle === "solid"
              ? parseFloat(css.outlineWidth) || 0
              : 0;
        paint.style.cssText = `position:absolute;left:${(box.left - origin.left) / scale}px;width:${box.width / scale}px;top:${i === 0 ? before : 0}px;height:${lineHeight - (i === 0 ? before : 0) - (next ? 0 : after)}px;box-sizing:border-box;pointer-events:none`;
        paint.style.backgroundColor = css.backgroundColor;
        if (border) {
          paint.style.borderLeft =
            paint.style.borderRight = `${border}px solid ${css.outlineColor}`;
          if (i === 0) paint.style.borderTop = paint.style.borderLeft;
          if (!next) paint.style.borderBottom = paint.style.borderLeft;
        }
        lines.push({
          top: 0,
          bottom: lineHeight,
          sourceFrom:line.sourceFrom,
          parts: [
            `<div style="position:relative;height:0">${paint.outerHTML}<div style="position:relative;top:${-top + firstSpace}px;height:0">${line.parts.join("")}</div></div>`,
          ],
        });
      }
      textOffset++; // Paragraph separator in documentText.
    }
    const result = lines.map((line) => ({
      html: line.parts.join(""),
      height: line.bottom,
      sourceFrom:line.sourceFrom,
    }));
    if (!versions) {
      versions = new Map();
      cache.set(source, versions);
    }
    if (versions.size >= 4) versions.delete(versions.keys().next().value!);
    versions.set(key, result);
    return result;
  } finally {
    host.remove();
  }
}
