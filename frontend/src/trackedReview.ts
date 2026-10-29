import { EditorState, type Transaction } from "prosemirror-state";
import { isHistoryTransaction, closeHistory } from "prosemirror-history";
import { Mapping, ReplaceStep } from "prosemirror-transform";
import { Slice, type Node as PMNode } from "prosemirror-model";
import type { DocNode } from "./types";
import { trackRangeTransaction } from "./trackedRanges";
import {
  trackParagraphFormatting,
  paragraphFormattingChanges,
  resolveParagraphFormatting,
  paragraphFormatView,
  type ParagraphFormatLog,
} from "./trackedParagraphFormatting";
import {
  documentChanges,
  resolveChanges,
  trackInlineTransaction,
  type RevisionStamp,
  type ReviewView,
} from "./trackedChanges";
import {
  paragraphChanges,
  resolveParagraphChanges,
  trackParagraphTransaction,
  reviewParagraphDocument,
} from "./trackedParagraphs";
import {
  formattingChanges,
  formatReviewDocument,
  resolveFormattingChanges,
  trackFormattingTransaction,
} from "./trackedFormatting";

export type ReviewChange = RevisionStamp & {
  ranges: {
    from: number;
    to: number;
    kind: "insertion" | "deletion" | "formatting";
    text: string;
    paragraph: boolean;
  }[];
};

/** The caller applies only the returned transaction; unsupported operations
 * leave the editor untouched and retain every pending review record. */
export function trackReviewTransaction(
  state: EditorState,
  tr: Transaction,
  stamp: RevisionStamp,
) {
  if (
    !tr.docChanged ||
    tr.getMeta("reviewDecision") ||
    tr.getMeta("addToHistory") === false ||
    isHistoryTransaction(tr)
  )
    return tr;
  if (tr.steps.length > 1) return trackCompositeTransaction(state, tr, stamp);
  return (
    trackWholeProseReplacement(state, tr, stamp) ||
    trackParagraphTransaction(state, tr, stamp) ||
    trackRangeTransaction(state, tr, stamp) ||
    trackFormattingTransaction(state, tr, stamp) ||
    trackParagraphFormatting(state, tr, stamp) ||
    trackInlineTransaction(state, tr, stamp)
  );
}

/** Select All replaces the document's outer paragraph tokens too. Retain the
 * first original paragraph and review its appearance separately, so rejection
 * restores every paragraph without retaining an empty wrapper in final view. */
function trackWholeProseReplacement(
  state: EditorState,
  source: Transaction,
  stamp: RevisionStamp,
): Transaction | null {
  const step = source.steps[0];
  if (
    !(step instanceof ReplaceStep) ||
    step.from !== 0 ||
    step.to !== state.doc.content.size ||
    step.slice.openStart ||
    step.slice.openEnd
  )
    return null;
  const prose = (node: PMNode) =>
    ["paragraph", "heading"].includes(node.type.name);
  if (!state.doc.childCount || !source.doc.childCount) return null;
  let supported = true;
  state.doc.forEach((node) => {
    if (!prose(node)) supported = false;
  });
  source.doc.forEach((node) => {
    if (!prose(node)) supported = false;
  });
  if (!supported) return null;
  const normalized = state.tr.replace(
    1,
    state.doc.content.size - 1,
    new Slice(source.doc.content, 1, 1),
  );
  normalized.setSelection(source.selection.map(normalized.doc, new Mapping()));
  copyTransactionMetadata(state, source, normalized);
  const result = trackReviewTransaction(state, normalized, stamp);
  const current = EditorState.create({
    doc: result.doc,
    selection: result.selection,
  });
  const target = source.doc.firstChild!;
  const appearance = current.tr.setNodeMarkup(0, target.type, {
    ...target.attrs,
    blockId: current.doc.firstChild!.attrs.blockId,
  });
  if (appearance.docChanged) {
    const tracked = trackParagraphFormatting(current, appearance, stamp);
    if (tracked) for (const step of tracked.steps) result.step(step);
  }
  return result;
}

function trackCompositeTransaction(
  state: EditorState,
  source: Transaction,
  stamp: RevisionStamp,
) {
  const result = closeHistory(state.tr),
    originals: number[] = [];
  const mapping = (count: number) => {
    const map = new Mapping(source.mapping.maps.slice(0, count)).invert();
    // Recover positions inside inserted content when an original step's
    // inverse is followed by its tracked counterpart plus annotation steps.
    result.mapping.maps.forEach((stepMap, index) => {
      const original = originals.indexOf(index);
      map.appendMap(stepMap, original < 0 ? undefined : count - 1 - original);
    });
    return map;
  };
  for (let i = 0; i < source.steps.length; i++) {
    const step = source.steps[i].map(mapping(i));
    if (!step)
      throw new Error(
        "This combined edit cannot retain its review boundaries. The document has not changed.",
      );
    const current = EditorState.create({
      doc: result.doc,
      selection: result.selection,
    });
    const part = current.tr.step(step);
    if (source.getMeta("uiEvent") !== undefined)
      part.setMeta("uiEvent", source.getMeta("uiEvent"));
    const tracked = trackReviewTransaction(current, part, stamp);
    if (tracked.steps[0].getMap().toString() !== step.getMap().toString())
      throw new Error(
        "This combined replacement needs separate review steps. The document has not changed.",
      );
    originals.push(result.steps.length);
    for (const recorded of tracked.steps) result.step(recorded);
  }
  result.setSelection(
    source.selection.map(result.doc, mapping(source.steps.length)),
  );
  if (source.storedMarksSet)
    result.setStoredMarks(
      source.storedMarks?.filter(
        (mark) => !mark.type.name.startsWith("revision_"),
      ) || null,
    );
  copyTransactionMetadata(state, source, result);
  if (source.scrolledIntoView) result.scrollIntoView();
  return result.setMeta("trackedEdit", stamp.id);
}

function copyTransactionMetadata(
  state: EditorState,
  source: Transaction,
  result: Transaction,
) {
  for (const key of [
    "uiEvent",
    "composition",
    "pointer",
    "paste",
    "caseCommand",
    "caseInput",
  ])
    if (source.getMeta(key) !== undefined)
      result.setMeta(key, source.getMeta(key));
  for (const plugin of state.plugins) {
    const value = source.getMeta(plugin);
    if (value !== undefined)
      result.setMeta(
        plugin,
        value?.transform === source ? { ...value, transform: result } : value,
      );
  }
}
export function reviewChanges(doc: PMNode) {
  const groups = new Map<string, ReviewChange>(
    documentChanges(doc).map((change) => [
      change.id,
      {
        ...change,
        ranges: change.ranges.map((range) => ({ ...range, paragraph: false })),
      },
    ]),
  );
  for (const { node, pos, log } of paragraphFormattingChanges(doc)) {
    for (const record of log.records) {
      if (record.status !== "pending") continue;
      const group = groups.get(record.stamp.id) || {
        ...record.stamp,
        ranges: [],
      };
      group.ranges.push({
        from: pos + 1,
        to: pos + node.nodeSize - 1,
        kind: "formatting",
        text: `Paragraph: ${node.textContent}`,
        paragraph: true,
      });
      groups.set(record.stamp.id, group);
    }
  }
  for (const { from, to, log } of formattingChanges(doc)) {
    for (const record of log.records) {
      if (record.status !== "pending") continue;
      const group = groups.get(record.stamp.id) || {
        ...record.stamp,
        ranges: [],
      };
      group.ranges.push({
        from,
        to,
        kind: "formatting",
        text: doc.textBetween(from, to),
        paragraph: false,
      });
      groups.set(record.stamp.id, group);
    }
  }
  for (const { node, pos } of paragraphChanges(doc)) {
    const stamp = node.attrs.stamp as RevisionStamp;
    const group = groups.get(stamp.id) || { ...stamp, ranges: [] };
    group.ranges.push({
      from: pos,
      to: pos + 1,
      kind: node.attrs.kind,
      text: "Paragraph break",
      paragraph: true,
    });
    groups.set(stamp.id, group);
  }
  return [...groups.values()].sort(
    (a, b) =>
      Math.min(...a.ranges.map((r) => r.from)) -
      Math.min(...b.ranges.map((r) => r.from)),
  );
}
export function resolveReviewChanges(
  state: EditorState,
  ids: ReadonlySet<string>,
  decision: "accept" | "reject",
) {
  const tr = resolveChanges(state, ids, decision);
  const intermediate = EditorState.create({
    doc: tr.doc,
    selection: tr.selection,
  });
  const structural = resolveParagraphChanges(intermediate, ids, decision);
  for (const step of structural.steps) tr.step(step);
  const formatted = resolveFormattingChanges(
    EditorState.create({ doc: tr.doc, selection: tr.selection }),
    ids,
    decision,
  );
  for (const step of formatted.steps) tr.step(step);
  const paragraphs = resolveParagraphFormatting(
    EditorState.create({ doc: tr.doc, selection: tr.selection }),
    ids,
    decision,
  );
  for (const step of paragraphs.steps) tr.step(step);
  return tr.setMeta("reviewDecision", true).scrollIntoView();
}

/** Apply an ordinary edit without accepting unrelated pending revisions. The
 * temporary record uses the same preservation rules as tracking, then only
 * this edit is accepted. Accepted property patches remain while necessary to
 * preserve their independence from earlier pending formatting decisions. */
export function editReviewedDocument(state: EditorState, source: Transaction) {
  const stamp = {
    id: `change_${crypto.randomUUID()}`,
    author: "Untracked edit",
    date: new Date().toISOString(),
  };
  const result = trackReviewTransaction(state, source, stamp);
  const accepted = resolveReviewChanges(
    EditorState.create({ doc: result.doc, selection: result.selection }),
    new Set([stamp.id]),
    "accept",
  );
  for (const step of accepted.steps) result.step(step);
  result.setMeta("trackedEdit", undefined);
  return result;
}

export function reviewedDocument(doc: PMNode, view: ReviewView) {
  return reviewParagraphDocument(
    paragraphFormatView(formatReviewDocument(doc, view), view),
    view,
  );
}

const revisionPresence = new WeakMap<PMNode, boolean>();
export function hasReviewChanges(node: PMNode): boolean {
  const cached = revisionPresence.get(node);
  if (cached !== undefined) return cached;
  let found =
    !!node.attrs.revisionProperties ||
    node.type.name === "revision_break" ||
    node.marks.some((m) => m.type.name.startsWith("revision_"));
  if (!found)
    for (let i = 0; i < node.childCount; i++)
      if (hasReviewChanges(node.child(i))) {
        found = true;
        break;
      }
  revisionPresence.set(node, found);
  return found;
}

const reviewSummaries = new WeakMap<DocNode, number>();
export function revisionCount(doc: DocNode): number {
  const cached = reviewSummaries.get(doc);
  if (cached !== undefined) return cached;
  const ids = new Set<string>();
  const walk = (node: DocNode) => {
    for (const record of (
      node.attrs?.revisionProperties as ParagraphFormatLog | null
    )?.records || [])
      if (record.status === "pending") ids.add(record.stamp.id);
    if (node.type === "revision_break")
      ids.add((node.attrs?.stamp as RevisionStamp).id);
    for (const mark of node.marks || []) {
      if (
        mark.type === "revision_insertion" ||
        mark.type === "revision_deletion"
      )
        ids.add(String(mark.attrs?.id));
      if (mark.type === "revision_format")
        for (const record of (
          mark.attrs as import("./trackedFormatting").FormatLog
        ).records)
          if (record.status === "pending") ids.add(record.stamp.id);
    }
    node.content?.forEach(walk);
  };
  walk(doc);
  reviewSummaries.set(doc, ids.size);
  return ids.size;
}
