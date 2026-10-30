import type { Node as PMNode } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import { Mapping } from "prosemirror-transform";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { api } from "./api";
import { resolveStyles } from "./styleResolution";
import type { NamedStyle, DocNode } from "./types";
import type { RunningMatter } from "./runningMatter";

export const validTextLanguage = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 40 &&
  /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value);
export const validHyphenation = (attrs: Record<string, unknown>) =>
  (attrs.textDirection == null ||
    ["ltr", "rtl"].includes(attrs.textDirection as string)) &&
  (attrs.hyphenation == null || typeof attrs.hyphenation === "boolean") &&
  (attrs.textLanguage == null || validTextLanguage(attrs.textLanguage));
type Word = { from: number; word: string };
const wordsByNode = new WeakMap<PMNode, Word[]>();
/** Retain logical positions across character formatting, but not links or objects. */
export function hyphenationWords(node: PMNode): Word[] {
  const cached = wordsByNode.get(node);
  if (cached) return cached;
  const words: Word[] = [];
  let text = "",
    start = 0;
  const flush = () => {
    for (const match of text.matchAll(/[\p{L}\p{M}]{5,}/gu))
      if ([...match[0]].length <= 80)
        words.push({ from: start + match.index!, word: match[0] });
    text = "";
  };
  node.forEach((child, offset) => {
    if (
      child.isText &&
      !child.marks.some((m) => ["code", "link"].includes(m.type.name))
    ) {
      if (!text) start = offset;
      text += child.text;
    } else flush();
  });
  flush();
  wordsByNode.set(node, words);
  return words;
}
type Status = { pending: boolean; error: string };
const statuses = new WeakMap<EditorView, Status>();
const breakPositions = new WeakMap<PMNode, Set<number>>();
const layoutChanges = new WeakMap<
  EditorView,
  { doc: PMNode; from: number; to: number }
>();
export const hyphenationLayoutChange = (view: EditorView) =>
  layoutChanges.get(view);
export const clearHyphenationLayoutChange = (view: EditorView) =>
  layoutChanges.delete(view);
export const hasDiscretionaryBreak = (doc: PMNode, pos: number) =>
  breakPositions.get(doc)?.has(pos) || false;
export const hyphenationStatus = (view: EditorView) =>
  statuses.get(view) || { pending: false, error: "" };
const storyCache = new WeakMap<DocNode, PMNode>();
const storyBreaks = new Map<string, number[]>();
export let hyphenationPaintVersion = 0;
const paintBreaks = (key: string, points: number[]) => {
  if (storyBreaks.has(key)) return;
  storyBreaks.set(key, points);
  hyphenationPaintVersion++;
  if (storyBreaks.size > 10000)
    storyBreaks.delete(storyBreaks.keys().next().value!);
};
const marker = (pos: number) =>
  Decoration.widget(
    pos,
    () => {
      const span = document.createElement("span");
      span.dataset.discretionaryHyphen = "true";
      span.className = "discretionary-hyphen";
      span.setAttribute("aria-hidden", "true");
      span.textContent = "\u00ad";
      return span;
    },
    { side: -1, key: "hyphen", ignoreSelection: true },
  );
export function frozenHyphenation(doc: PMNode) {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock || !node.attrs.hyphenation) return;
    for (const word of hyphenationWords(node))
      for (const point of storyBreaks.get(
        (node.attrs.textLanguage || "en") + "\0" + word.word,
      ) || [])
        decos.push(marker(pos + 1 + word.from + point));
    return false;
  });
  return DecorationSet.create(doc, decos);
}
/** Unused opportunities must retain their layout boxes, but not contribute
 * invisible characters to the PDF text stream. Never reshape a print copy. */
export function freezePrintedHyphens(root: HTMLElement) {
  for (const marker of root.querySelectorAll<HTMLElement>(
    ".discretionary-hyphen",
  )) {
    if (marker.dataset.printHyphen !== "true")
      marker.style.visibility = "hidden";
  }
}
type Options = {
  styles: NamedStyle[];
  language: string;
  enabled: boolean;
  runningMatter?: RunningMatter;
};
export function discretionaryHyphens(
  options: () => Options,
  refresh: (view: EditorView) => void,
  onError: (message: string) => void,
) {
  let view: EditorView | undefined,
    alive = true,
    scheduled = false,
    busy = false,
    epoch = 0,
    lastDoc: PMNode | undefined,
    lastOptions: Options | undefined,
    lastEpoch = -1,
    decos = DecorationSet.empty;
  let mappedDocument: PMNode | undefined, pendingMapping: Mapping | undefined;
  let wordRanges = new Map<string, { from: number; to: number }>();
  const updatedWords = new Set<string>();
  const cache = new Map<string, number[]>(),
    requests = new Map<string, { language: string; word: string }>(),
    storyKeys = new Set<string>(),
    failures = new Map<string, string>();
  const status: Status = { pending: false, error: "" };
  const update = () => {
    if (!alive || !view) return;
    if (view.composing) {
      setTimeout(update, 50);
      return;
    }
    refresh(view);
    view.dom.dispatchEvent(new Event("alder-text-layout"));
  };
  const drain = async () => {
    scheduled = false;
    if (busy || !alive) return;
    busy = true;
    try {
      while (requests.size && alive) {
        const first = requests.values().next().value!;
        const batch = [...requests]
          .filter(([, v]) => v.language === first.language)
          .slice(0, 512);
        try {
          const result = await api<{ breaks: number[][] }>(
            "/api/hyphenation",
            "POST",
            { language: first.language, words: batch.map(([, v]) => v.word) },
          );
          batch.forEach(([key], i) => {
            cache.set(key, result.breaks[i] || []);
            updatedWords.add(key);
            if (storyKeys.has(key)) paintBreaks(key, result.breaks[i] || []);
            requests.delete(key);
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          failures.set(first.language, message);
          for (const [key, value] of requests)
            if (value.language === first.language) requests.delete(key);
          if (alive) onError(message);
        }
      }
    } finally {
      busy = false;
      status.pending = requests.size > 0;
      epoch++;
      update();
    }
  };
  return new Plugin({
    state: {
      init: () => null,
      apply(tr, value) {
        if (tr.docChanged) {
          if (mappedDocument === tr.before && pendingMapping)
            pendingMapping.appendMapping(tr.mapping);
          else if (lastDoc === tr.before) {
            pendingMapping = new Mapping();
            pendingMapping.appendMapping(tr.mapping);
          } else pendingMapping = undefined;
          mappedDocument = tr.doc;
        }
        return value;
      },
    },
    props: {
      decorations(state) {
        const opts = options();
        const sameOptions =
          (lastOptions?.styles === opts.styles ||
            (!lastOptions?.styles.length && !opts.styles.length)) &&
          lastOptions?.language === opts.language &&
          lastOptions?.enabled === opts.enabled &&
          lastOptions?.runningMatter === opts.runningMatter;
        if (lastDoc === state.doc && lastEpoch === epoch && sameOptions)
          return decos;
        // Mapping retains unchanged paragraph subtrees. Rebuilding a flat set
        // of every discretionary break is quadratic in long manuscripts.
        let changed: { from: number; to: number } | undefined;
        let retained = DecorationSet.empty;
        const positions = new Set<number>();
        if (
          lastDoc &&
          lastDoc !== state.doc &&
          sameOptions &&
          lastEpoch === epoch &&
          pendingMapping &&
          mappedDocument === state.doc
        ) {
          const start = lastDoc.content.findDiffStart(state.doc.content),
            end = lastDoc.content.findDiffEnd(state.doc.content);
          if (start != null && end) {
            const from = state.doc.resolve(
              Math.min(start, state.doc.content.size),
            );
            const to = state.doc.resolve(
              Math.min(state.doc.content.size, Math.max(start, end.b)),
            );
            const boundary = (position: typeof from, edge: "start" | "end") => {
              for (let depth = position.depth; depth > 0; depth--)
                if (position.node(depth).isTextblock)
                  return edge === "start"
                    ? position.before(depth)
                    : position.after(depth);
              return position.pos;
            };
            changed = {
              from: boundary(from, "start"),
              to: boundary(to, "end"),
            };
            retained = decos.map(pendingMapping, state.doc);
            retained = retained.remove(
              retained
                .find(changed.from, changed.to)
                .filter((d) => d.from >= changed!.from && d.to <= changed!.to),
            );
            for (const old of breakPositions.get(lastDoc) || []) {
              const mapped = pendingMapping.mapResult(old, -1);
              if (
                !mapped.deleted &&
                (mapped.pos < changed.from || mapped.pos > changed.to)
              )
                positions.add(mapped.pos);
            }
          }
        }
        if (
          lastDoc === state.doc &&
          sameOptions &&
          lastEpoch !== epoch &&
          updatedWords.size
        ) {
          const ranges = [...updatedWords].flatMap((key) =>
            wordRanges.has(key) ? [wordRanges.get(key)!] : [],
          );
          if (ranges.length) {
            let from = Infinity,
              to = -Infinity;
            for (const range of ranges) {
              from = Math.min(from, range.from);
              to = Math.max(to, range.to);
            }
            // Initial dictionary loading touches the whole manuscript. Later
            // replies usually belong to the one paragraph being typed.
            if (from > 0 || to < state.doc.content.size) {
              changed = { from, to };
              retained = decos.remove(
                decos
                  .find(from, to)
                  .filter((d) => d.from >= from && d.to <= to),
              );
              for (const old of breakPositions.get(state.doc) || [])
                if (old < from || old > to) positions.add(old);
            }
          }
        }
        updatedWords.clear();
        pendingMapping = undefined;
        mappedDocument = undefined;
        lastDoc = state.doc;
        lastOptions = opts;
        lastEpoch = epoch;
        status.error = "";
        const decorations: Decoration[] = [];
        const used = new Set<string>();
        const nextWordRanges = new Map<string, { from: number; to: number }>();
        storyKeys.clear();
        let styles: ReturnType<typeof resolveStyles> = new Map();
        try {
          styles = resolveStyles(opts.styles);
        } catch {}
        const collectStories = (matter?: RunningMatter) => {
          for (const part of [matter?.header, matter?.footer])
            for (const source of Object.values(part || {})) {
              if (!source) continue;
              let story = storyCache.get(source);
              if (!story) {
                story = state.schema.nodeFromJSON(source);
                storyCache.set(source, story!);
              }
              story!.descendants((node) => {
                if (!node.isTextblock) return;
                const style = styles.get(node.attrs.styleId),
                  language =
                    node.attrs.textLanguage ||
                    style?.textLanguage ||
                    opts.language ||
                    "en";
                if (!(node.attrs.hyphenation ?? style?.hyphenation))
                  return false;
                if (failures.has(language)) {
                  status.error = failures.get(language)!;
                  return false;
                }
                for (const word of hyphenationWords(node)) {
                  const id = language + "\0" + word.word;
                  used.add(id);
                  storyKeys.add(id);
                  const points = cache.get(id);
                  if (points) paintBreaks(id, points);
                  else requests.set(id, { language, word: word.word });
                }
                return false;
              });
            }
        };
        if (opts.enabled) collectStories(opts.runningMatter);
        if (opts.enabled)
          state.doc.descendants((node, pos) => {
            if (node.type.name === "section_break")
              collectStories(node.attrs.runningMatter);
            if (!node.isTextblock) return;
            const repaint =
              !changed ||
              (pos < changed.to && pos + node.nodeSize > changed.from);
            const inherited = styles.get(node.attrs.styleId),
              language =
                node.attrs.textLanguage ||
                inherited?.textLanguage ||
                opts.language ||
                "en";
            if (
              repaint &&
              !node.attrs.textDirection &&
              inherited?.textDirection
            )
              decorations.push(
                Decoration.node(pos, pos + node.nodeSize, {
                  dir: inherited.textDirection,
                }),
              );
            if (
              repaint &&
              !node.attrs.textLanguage &&
              inherited?.textLanguage &&
              validTextLanguage(language)
            )
              decorations.push(
                Decoration.node(pos, pos + node.nodeSize, { lang: language }),
              );
            if (
              node.type.name === "code_block" ||
              !(node.attrs.hyphenation ?? inherited?.hyphenation)
            )
              return false;
            if (failures.has(language)) {
              status.error = failures.get(language)!;
              return false;
            }
            for (const word of hyphenationWords(node)) {
              const id = language + "\0" + word.word;
              const range = nextWordRanges.get(id);
              if (range) range.to = pos + node.nodeSize;
              else
                nextWordRanges.set(id, { from: pos, to: pos + node.nodeSize });
              used.add(id);
              const points = cache.get(id);
              if (!points) {
                requests.set(id, { language, word: word.word });
                continue;
              }
              if (!repaint) continue;
              for (const point of points)
                if (point > 0 && point < word.word.length) {
                  positions.add(pos + 1 + word.from + point);
                  decorations.push(
                    Decoration.widget(
                      pos + 1 + word.from + point,
                      () => {
                        const span = document.createElement("span");
                        span.dataset.discretionaryHyphen = "true";
                        span.className = "discretionary-hyphen";
                        span.setAttribute("aria-hidden", "true");
                        span.textContent = "\u00ad";
                        return span;
                      },
                      { side: -1, key: "hyphen", ignoreSelection: true },
                    ),
                  );
                }
            }
            return false;
          });
        // Keep only words belonging to this live document; stale replies can
        // populate the cache, but never insert positions from an earlier edit.
        wordRanges = nextWordRanges;
        for (const id of cache.keys()) if (!used.has(id)) cache.delete(id);
        for (const id of requests.keys())
          if (!used.has(id)) requests.delete(id);
        status.pending = requests.size > 0 || busy;
        if (requests.size && !scheduled && !busy) {
          scheduled = true;
          queueMicrotask(() => void drain());
        }
        decos = changed
          ? retained.add(state.doc, decorations)
          : DecorationSet.create(state.doc, decorations);
        const previous = breakPositions.get(state.doc);
        if (view && previous) {
          let from = Infinity,
            to = -Infinity;
          for (const position of previous)
            if (!positions.has(position)) {
              from = Math.min(from, position);
              to = Math.max(to, position);
            }
          for (const position of positions)
            if (!previous.has(position)) {
              from = Math.min(from, position);
              to = Math.max(to, position);
            }
          if (from !== Infinity) {
            const earlier = layoutChanges.get(view);
            layoutChanges.set(view, {
              doc: state.doc,
              from: Math.min(from, earlier?.from ?? from),
              to: Math.max(to, earlier?.to ?? to),
            });
          }
        }
        breakPositions.set(state.doc, positions);
        return decos;
      },
    },
    view(v) {
      alive = true;
      view = v;
      statuses.set(v, status);
      return {
        destroy() {
          alive = false;
          statuses.delete(v);
          layoutChanges.delete(v);
          requests.clear();
          // ProseMirror also recreates plugin views when the history owner is
          // reconfigured. The plugin instance and its bounded word cache live
          // on; discarding it here would rehyphenate the entire manuscript on
          // each ordinary command. A genuinely discarded plugin is collected.
        },
      };
    },
  });
}
