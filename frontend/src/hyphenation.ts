import type { Node as PMNode } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import { Mapping } from "prosemirror-transform";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { api } from "./api";
import { indexedDecorations } from "./indexedDecorations";
import { createDecorations, addDecorations, filterDecorations } from "./decorationTree";
import { HyphenationUsage } from "./hyphenationUsage";
import { hasHyphenationPosition, changedHyphenationPositions, type HyphenationPositions } from "./hyphenationPositions";
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
const wordGroupsByNode = new WeakMap<PMNode, Map<string, number[]>>();
/** Dictionary/range bookkeeping is once per distinct word; painting still
 * retains every occurrence and its exact UTF-16 position. */
function hyphenationWordGroups(node: PMNode) {
  let groups = wordGroupsByNode.get(node);
  if (!groups) {
    groups = new Map();
    for (const { word, from } of hyphenationWords(node)) {
      const offsets = groups.get(word);
      if (offsets) offsets.push(from);
      else groups.set(word, [from]);
    }
    wordGroupsByNode.set(node, groups);
  }
  return groups;
}

type Status = { pending: boolean; error: string };
const statuses = new WeakMap<EditorView, Status>();
const simpleLayouts = new WeakMap<PMNode, boolean>();
const simpleHyphenationLayout = (doc: PMNode) => {
  let result = simpleLayouts.get(doc);
  if (result === undefined) {
    result = doc.content.content.every(node => {
      let plain = simpleLayouts.get(node);
      if (plain === undefined) {
        plain = ['paragraph', 'heading'].includes(node.type.name) &&
          node.content.content.every(child => child.isText || child.type.name === 'hard_break');
        simpleLayouts.set(node, plain);
      }
      return plain;
    });
    simpleLayouts.set(doc, result);
  }
  return result;
};
const presentations = new WeakMap<EditorView, { expand: () => void; settle: (deferDuringTyping?: boolean) => void }>();
/** A settled plain-prose layout needs only the opportunities that actually
 * break a line. Restore the others before geometry changes, never by editing
 * authored text or intercepting the browser's selection APIs. */
export function expandHyphenation(view: EditorView) { presentations.get(view)?.expand(); }
export function settleHyphenation(view: EditorView, deferDuringTyping = false) { presentations.get(view)?.settle(deferDuringTyping); }
const breakPositions = new WeakMap<PMNode, HyphenationPositions>();
const layoutChanges = new WeakMap<
  EditorView,
  { doc: PMNode; from: number; to: number }
>();
export const hyphenationLayoutChange = (view: EditorView) =>
  layoutChanges.get(view);
export const clearHyphenationLayoutChange = (view: EditorView) =>
  layoutChanges.delete(view);
export const hasDiscretionaryBreak = (doc: PMNode, pos: number) =>
  hasHyphenationPosition(breakPositions.get(doc) || [], pos);
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
  return createDecorations(doc, decos);
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
  let settled = new WeakSet<PMNode>();
  let compacted = false;
  let editedAt = -Infinity;
  const usage = new HyphenationUsage(node => hyphenationWordGroups(node).keys());
  const wordRanges = usage.ranges;
  const paragraphPositions = new WeakMap<PMNode, ReadonlySet<number>>();
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
          editedAt = performance.now();
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
        if (compacted && !simpleHyphenationLayout(state.doc)) {
          compacted = false;
          settled = new WeakSet();
          lastDoc = undefined;
        }
        const sameOptions =
          (lastOptions?.styles === opts.styles ||
            (!lastOptions?.styles.length && !opts.styles.length)) &&
          lastOptions?.language === opts.language &&
          lastOptions?.enabled === opts.enabled &&
          lastOptions?.runningMatter === opts.runningMatter;
        if (lastDoc === state.doc && lastEpoch === epoch && sameOptions)
          return indexedDecorations(decos);
        const reuseUsage = sameOptions && lastDoc === state.doc;
        const usageMapping = sameOptions && lastDoc === state.doc ? new Mapping()
          : sameOptions && mappedDocument === state.doc ? pendingMapping : undefined;
        // Mapping retains unchanged paragraph subtrees. Rebuilding a flat set
        // of every discretionary break is quadratic in long manuscripts.
        let changed: { from: number; to: number } | undefined;
        let retained = DecorationSet.empty;
        const positions: { from: number; points: ReadonlySet<number> }[] = [];
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
        const usedParagraphs: { node: PMNode; from: number; to: number; language: string }[] = [];
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
                for (const word of hyphenationWordGroups(node).keys()) {
                  const id = language + "\0" + word;
                  storyKeys.add(id);
                  const points = cache.get(id);
                  if (points) paintBreaks(id, points);
                  else requests.set(id, { language, word });
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
            const end = pos + node.nodeSize;
            const repaint =
              !changed ||
              (pos < changed.to && end > changed.from);
            if (repaint) settled.delete(node);
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
                Decoration.node(pos, end, {
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
                Decoration.node(pos, end, { lang: language }),
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
            if (!reuseUsage) usedParagraphs.push({ node, from: pos, to: end, language });
            const pointsForParagraph = repaint ? new Set<number>() : paragraphPositions.get(node)!;
            positions.push({ from: pos + 1, points: pointsForParagraph });
            if (repaint) paragraphPositions.set(node, pointsForParagraph);
            if (!repaint) return false;
            for (const [word, offsets] of hyphenationWordGroups(node)) {
              const id = language + "\0" + word;
              const points = cache.get(id);
              if (!points) {
                requests.set(id, { language, word });
                continue;
              }
              for (const from of offsets)
                for (const point of points)
                  if (point > 0 && point < word.length) {
                    const position = pos + 1 + from + point;
                    (pointsForParagraph as Set<number>).add(from + point);
                    decorations.push(marker(position));
                  }
            }
            return false;
          });
        // Keep only words belonging to this live document; stale replies can
        // populate the cache, but never insert positions from an earlier edit.
        if (!reuseUsage) usage.update(usedParagraphs, usageMapping);
        for (const id of cache.keys()) if (!wordRanges.has(id) && !storyKeys.has(id)) cache.delete(id);
        for (const id of requests.keys())
          if (!wordRanges.has(id) && !storyKeys.has(id)) requests.delete(id);
        status.pending = requests.size > 0 || busy;
        if (requests.size && !scheduled && !busy) {
          scheduled = true;
          queueMicrotask(() => void drain());
        }
        decos = changed
          ? addDecorations(state.doc, retained, decorations)
          : createDecorations(state.doc, decorations);
        const previous = breakPositions.get(state.doc);
        if (view && previous) {
          const changed = changedHyphenationPositions(previous, positions);
          if (changed) {
            const { from, to } = changed;
            const earlier = layoutChanges.get(view);
            layoutChanges.set(view, {
              doc: state.doc,
              from: Math.min(from, earlier?.from ?? from),
              to: Math.max(to, earlier?.to ?? to),
            });
          }
        }
        breakPositions.set(state.doc, positions);
        return indexedDecorations(decos);
      },
    },
    view(v) {
      alive = true;
      view = v;
      statuses.set(v, status);
      let settlement: ReturnType<typeof setTimeout> | undefined;
      presentations.set(v, {
        expand() {
          if (!compacted) return;
          compacted = false;
          settled = new WeakSet();
          lastDoc = undefined;
          v.updateState(v.state);
        },
        settle(deferDuringTyping = false) {
          clearTimeout(settlement);
          // Keep the edited paragraph's opportunities throughout a typing
          // burst. Removing/reinserting them on every key forces an extra DOM
          // selection/layout pass; their bounded presence does not affect the
          // settled geometry of the rest of the manuscript.
          if (deferDuringTyping && performance.now() - editedAt < 140) {
            settlement = setTimeout(() => presentations.get(v)?.settle(true), 150);
            return;
          }
          // Objects, columns and nested containers can depend on intrinsic
          // word widths. Keep their complete opportunities available.
          if (v.composing || !simpleHyphenationLayout(v.state.doc))
            return;
          const unused = new Set<number>();
          // Removing a zero-width run can change fractional glyph rounding.
          // Keep the full set if that changes a block's height or a physical
          // page boundary. Horizontal glyph coordinates are always read live.
          const geometry = (element: HTMLElement) => {
            const box = element.getBoundingClientRect();
            return [box.height, ...[...element.querySelectorAll('.pagination-spacer')].map(spacer => spacer.getBoundingClientRect().top - box.top)];
          };
          const blocks: { from: number; to: number; element: HTMLElement; geometry: number[] }[] = [];
          const roots = [...v.dom.children].filter(element => !element.classList.contains('ProseMirror-widget'));
          v.state.doc.forEach((node, pos, index) => {
            if (settled.has(node)) return;
            settled.add(node);
            const element = roots.length === v.state.doc.childCount ? roots[index] : v.nodeDOM(pos);
            if (!(element instanceof HTMLElement)) return;
            const markers = [...element.querySelectorAll<HTMLElement>('.discretionary-hyphen')];
            const pageBreaks = new Set(markers.filter(marker => marker.textContent === '-').map(marker => v.posAtDOM(marker, 0)));
            const opportunities = markers.filter(marker => marker.textContent === '\u00ad');
            const spans = decos.find(pos + 1, pos + node.nodeSize - 1).filter(item => item.spec.key === 'hyphen');
            // A plain paragraph's widget order is its decoration order. Use
            // that checked correspondence instead of walking every preceding
            // root sibling for every invisible marker through posAtDOM.
            const positions = opportunities.length === spans.length ? spans : undefined;
            const before = unused.size;
            for (const [index, marker] of opportunities.entries()) {
              if (marker.getBoundingClientRect().width > 0.5) continue;
              const position = positions ? positions[index].from : v.posAtDOM(marker, 0);
              if (!pageBreaks.has(position)) unused.add(position);
            }
            if (unused.size !== before) blocks.push({ from: pos, to: pos + node.nodeSize, element, geometry: geometry(element) });
          });
          if (!unused.size) return;
          const removed = decos.find().filter(item => item.spec.key === 'hyphen' && unused.has(item.from));
          if (!removed.length) return;
          decos = filterDecorations(decos, item => item.spec.key !== 'hyphen' || !unused.has(item.from));
          compacted = true;
          v.updateState(v.state);
          const changed = blocks.filter(block => {
            const after = geometry(block.element);
            return after.length !== block.geometry.length || after.some((value, index) => Math.abs(value - block.geometry[index]) > 0.01);
          });
          if (changed.length) {
            decos = addDecorations(v.state.doc, decos, removed.filter(item => changed.some(block => item.from > block.from && item.from < block.to)));
            v.updateState(v.state);
          }
        },
      });
      return {
        destroy() {
          clearTimeout(settlement);
          alive = false;
          // A history implementation may retain its most recent plugin array.
          // The reusable dictionary cache must not keep the destroyed view or
          // its complete editable DOM alive through that array.
          view = undefined;
          statuses.delete(v);
          presentations.delete(v);
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
