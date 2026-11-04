import type { Node as PMNode } from "prosemirror-model";
import type { FlowPage, PageLayout } from "./pageFlow";
import { pagesInRange, physicalPageAtPosition } from "./pageRanges";
import { formatPageNumber } from "./pageNumbering";
import { documentNotes } from "./documentNotes";

export type ChapterBlocks = {
  id: string;
  title: string;
  fromBlock: number;
  bodyFromBlock: number;
  toBlock: number;
};
export type ChapterPageContext = {
  id: string;
  title: string;
  from: number;
  bodyFrom: number;
  to: number;
  pageIndexes: number[];
  bodyPage: number;
  bodyPageLabel: string;
  startsOnSharedPage: boolean;
};

/** Resolve against the final measured whole book, after generated fields settle.
 * Block boundaries survive variable-length fields and UTF-16 text; summing
 * independently laid out chapters cannot account for shared pages/front matter. */
export function bookPageContext(
  doc: PMNode,
  pages: FlowPage[],
  layout: PageLayout,
  chapters: readonly ChapterBlocks[],
): ChapterPageContext[] {
  if (!pages.length) throw Error("The book has not been paginated.");
  const offsets: number[] = [];
  doc.forEach((_node, pos) => offsets.push(pos));
  offsets.push(doc.content.size);
  const ids = new Set<string>();
  let previousEnd = 0;
  const result = chapters.map((chapter) => {
    const { id, fromBlock, bodyFromBlock, toBlock } = chapter;
    if (!id || ids.has(id) || ![fromBlock, bodyFromBlock, toBlock].every(Number.isSafeInteger) ||
      fromBlock < previousEnd || bodyFromBlock < fromBlock || toBlock < bodyFromBlock || toBlock > doc.childCount)
      throw Error("The book chapter boundaries do not match its layout.");
    previousEnd = toBlock;
    ids.add(id);
    const from = offsets[fromBlock], bodyFrom = offsets[bodyFromBlock], to = offsets[toBlock];
    const first = doc.maybeChild(bodyFromBlock);
    const position = bodyFrom + (first?.isTextblock && bodyFromBlock < toBlock ? 1 : 0);
    const bodyPage = physicalPageAtPosition(pages, position)!;
    const current = pages[bodyPage].frame?.layout || layout;
    return {
      id, title: chapter.title, from, bodyFrom, to,
      pageIndexes: pagesInRange(pages, from, to),
      bodyPage,
      bodyPageLabel: formatPageNumber(bodyPage + (current.pageNumberOffset ?? current.firstPageNumber ?? 1), current.pageNumberFormat),
      startsOnSharedPage: pages[bodyPage].from < from,
    };
  });
  // Notes can continue beyond a chapter's final body range, or appear in a
  // shared/end-of-book note bank. Attribute those physical sheets as well.
  const owners = new Map<string, ChapterPageContext>();
  for (const note of documentNotes(doc)) {
    const owner = result.find((chapter) => chapter.bodyFrom <= note.pos && note.pos < chapter.to);
    if (owner) owners.set(note.id, owner);
  }
  pages.forEach((page, index) => {
    for (const match of (page.noteHTML || "").matchAll(/data-note-fragment="([^"]+)"/g)) {
      const owner = owners.get(match[1]);
      if (owner && !owner.pageIndexes.includes(index)) owner.pageIndexes.push(index);
    }
  });
  for (const chapter of result) chapter.pageIndexes.sort((a, b) => a - b);
  return result;
}
