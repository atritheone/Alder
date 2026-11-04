import type { Node as PMNode } from "prosemirror-model";
import type { Mapping } from "prosemirror-transform";

type Paragraph = { node: PMNode; from: number; to: number; language: string };
type Usage = Paragraph & { count: number };

/** Dictionary lifetimes are counted per immutable paragraph. Ordinary edits
 * inspect the words in changed paragraphs only. Bounds may be conservative
 * after deletions, but always cover every remaining occurrence; dictionary
 * replies can then invalidate extra paragraphs, never miss a live one. */
export class HyphenationUsage {
  private paragraphs = new Map<PMNode, Usage>();
  private counts = new Map<string, number>();
  readonly ranges = new Map<string, { from: number; to: number }>();
  constructor(private words: (node: PMNode) => Iterable<string>) {}

  update(entries: Paragraph[], mapping?: Mapping) {
    if (!mapping) {
      this.paragraphs.clear(); this.counts.clear(); this.ranges.clear();
    } else if (mapping.maps.length) {
      for (const range of this.ranges.values()) {
        range.from = mapping.map(range.from, -1);
        range.to = mapping.map(range.to, 1);
      }
    }
    const next = new Map<PMNode, Usage>();
    for (const entry of entries) {
      const existing = next.get(entry.node);
      if (existing) {
        existing.count++;
        existing.from = Math.min(existing.from, entry.from);
        existing.to = Math.max(existing.to, entry.to);
      } else next.set(entry.node, { ...entry, count: 1 });
    }
    const adjust = (entry: Usage, delta: number, extend = false) => {
      if (!delta && !extend) return;
      for (const word of this.words(entry.node)) {
        const id = entry.language + "\0" + word;
        if (delta) this.counts.set(id, (this.counts.get(id) || 0) + delta);
        if (extend) {
          const range = this.ranges.get(id);
          if (range) { range.from = Math.min(range.from, entry.from); range.to = Math.max(range.to, entry.to); }
          else this.ranges.set(id, { from: entry.from, to: entry.to });
        }
      }
    };
    for (const [node, previous] of this.paragraphs) {
      const current = next.get(node);
      if (!current || current.language !== previous.language) adjust(previous, -previous.count);
    }
    for (const [node, current] of next) {
      const previous = this.paragraphs.get(node);
      const sameLanguage = previous?.language === current.language;
      const extend = !sameLanguage || !mapping ||
        current.from < mapping.map(previous!.from, -1) || current.to > mapping.map(previous!.to, 1);
      adjust(current, current.count - (sameLanguage ? previous!.count : 0), extend);
    }
    for (const [id, count] of this.counts) if (!count) { this.counts.delete(id); this.ranges.delete(id); }
    this.paragraphs = next;
  }
}
