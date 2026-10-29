import {
  Fragment,
  type Mark,
  type MarkSpec,
  type Node as PMNode,
  type Schema,
} from "prosemirror-model";
import { closeHistory } from "prosemirror-history";
import { AddMarkStep, RemoveMarkStep } from "prosemirror-transform";
import type { EditorState, Transaction } from "prosemirror-state";
import {
  isRevisionMark,
  validRevisionStamp,
  type RevisionStamp,
  type ReviewView,
} from "./trackedChanges";

type Format = { type: string; attrs?: Record<string, unknown> };
type Patch = {
  type: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};
export type FormatRecord = {
  stamp: RevisionStamp;
  status: "pending" | "accepted" | "rejected";
  patches: Patch[];
};
export type FormatLog = { base: Format[]; records: FormatRecord[] };
const actual = (marks: readonly Mark[]) =>
  marks.filter(
    (mark) =>
      !isRevisionMark(mark.type.name) && mark.type.name !== "revision_format",
  );
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export function validFormatLog(value: unknown): value is FormatLog {
  const log = value as FormatLog;
  const format = (value: unknown) =>
    value === null ||
    (!!value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (!(value as Record<string, unknown>).href ||
        (typeof (value as any).href === "string" &&
          !/^\s*(javascript|vbscript|data|file):/i.test((value as any).href))));
  const type = (value: unknown) =>
    typeof value === "string" &&
    [
      "strong",
      "em",
      "underline",
      "strike",
      "code",
      "link",
      "text_style",
      "highlight",
      "subscript",
      "superscript",
    ].includes(value);
  return (
    !!log &&
    Array.isArray(log.base) &&
    log.base.every(
      (m) => !!m && type(m.type) && (m.attrs === undefined || format(m.attrs)),
    ) &&
    Array.isArray(log.records) &&
    log.records.length > 0 &&
    log.records.length <= 1000 &&
    log.records.every(
      (r) =>
        r &&
        validRevisionStamp(r.stamp) &&
        ["pending", "accepted", "rejected"].includes(r.status) &&
        Array.isArray(r.patches) &&
        r.patches.length > 0 &&
        r.patches.every(
          (p) => p && type(p.type) && format(p.before) && format(p.after),
        ),
    )
  );
}
export const revisionFormatSpec: MarkSpec = {
  attrs: { base: {}, records: {} },
  inclusive: false,
  parseDOM: [
    {
      tag: "span[data-revision-format]",
      priority: 80,
      getAttrs(dom) {
        try {
          const value = JSON.parse(
            dom.getAttribute("data-revision-format") || "null",
          );
          return validFormatLog(value) ? value : false;
        } catch {
          return false;
        }
      },
    },
  ],
  toDOM: (mark) => [
    "span",
    {
      "data-revision-format": JSON.stringify(mark.attrs),
      class: "document-revision-format",
    },
    0,
  ],
};
/** Reapply attribute differences, not whole style snapshots. Thus a later
 * font-size change does not implicitly accept an earlier font-family change. */
export function formatMarks(
  schema: Schema,
  log: FormatLog,
  original = false,
): Mark[] {
  const marks = new Map(
    log.base.map((mark) => [mark.type, { ...(mark.attrs || {}) }]),
  );
  for (const record of log.records) {
    if (
      record.status === "rejected" ||
      (original && record.status === "pending")
    )
      continue;
    for (const patch of record.patches) {
      if (patch.after === null) {
        marks.delete(patch.type);
        continue;
      }
      if (patch.before === null) {
        marks.set(patch.type, { ...patch.after });
        continue;
      }
      const current = { ...(marks.get(patch.type) || {}) };
      for (const key of new Set([
        ...Object.keys(patch.before),
        ...Object.keys(patch.after),
      ])) {
        if (same(patch.before[key], patch.after[key])) continue;
        if (Object.hasOwn(patch.after, key))
          Object.defineProperty(current, key, {
            value: patch.after[key],
            enumerable: true,
            configurable: true,
            writable: true,
          });
        else delete current[key];
      }
      marks.set(patch.type, current);
    }
  }
  let result: readonly Mark[] = [];
  for (const [name, attrs] of marks) {
    if (
      !schema.marks[name] ||
      isRevisionMark(name) ||
      name === "revision_format"
    )
      throw new Error("This formatting revision uses an unsupported style.");
    result = schema.marks[name].create(attrs).addToSet(result);
  }
  return [...result];
}
export function trackFormattingTransaction(
  state: EditorState,
  tr: Transaction,
  stamp: RevisionStamp,
): Transaction | null {
  if (
    !validRevisionStamp(stamp) ||
    !tr.steps.length ||
    !tr.steps.every(
      (step) => step instanceof AddMarkStep || step instanceof RemoveMarkStep,
    )
  )
    return null;
  const spans = tr.steps.map((step) => ({
    from: (step as AddMarkStep).from,
    to: (step as AddMarkStep).to,
  }));
  const pieces: {
    from: number;
    to: number;
    before: readonly Mark[];
    after: readonly Mark[];
  }[] = [];
  tr.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const ranges = spans.filter(
      (span) => span.from < pos + node.nodeSize && span.to > pos,
    );
    if (!ranges.length) return;
    const from = Math.max(pos, Math.min(...ranges.map((span) => span.from))),
      to = Math.min(
        pos + node.nodeSize,
        Math.max(...ranges.map((span) => span.to)),
      );
    // Prior formatting can have additional run boundaries inside the new run.
    state.doc.nodesBetween(from, to, (before, at) => {
      if (before.isText)
        pieces.push({
          from: Math.max(from, at),
          to: Math.min(to, at + before.nodeSize),
          before: before.marks,
          after: node.marks,
        });
    });
  });
  for (const piece of pieces) {
    // Clear character formatting must never accept an insertion implicitly.
    for (const mark of piece.before.filter((m) => isRevisionMark(m.type.name)))
      tr.addMark(piece.from, piece.to, mark);
    if (piece.before.some((mark) => mark.type.name === "revision_deletion")) {
      tr.removeMark(piece.from, piece.to);
      for (const mark of piece.before) tr.addMark(piece.from, piece.to, mark);
      continue;
    }
    const before = new Map(
        actual(piece.before).map((m) => [m.type.name, m.attrs]),
      ),
      after = new Map(actual(piece.after).map((m) => [m.type.name, m.attrs]));
    const patches: Patch[] = [];
    for (const type of new Set([...before.keys(), ...after.keys()])) {
      const old = before.get(type) || null,
        next = after.get(type) || null;
      if (!same(old, next)) patches.push({ type, before: old, after: next });
    }
    const previous = piece.before.find(
      (mark) => mark.type.name === "revision_format",
    );
    if (!patches.length) {
      // Clear formatting may remove metadata along with visible marks.
      if (previous) tr.addMark(piece.from, piece.to, previous);
      continue;
    }
    const log: FormatLog = previous
      ? (previous.attrs as FormatLog)
      : { base: actual(piece.before).map((m) => m.toJSON()), records: [] };
    const next = {
      base: log.base,
      records: [...log.records, { stamp, status: "pending", patches }],
    };
    tr.addMark(
      piece.from,
      piece.to,
      state.schema.marks.revision_format.create(next),
    );
  }
  return tr.setMeta("trackedEdit", stamp.id);
}
export function formattingChanges(doc: PMNode) {
  const found: { from: number; to: number; log: FormatLog }[] = [];
  doc.descendants((node, pos) => {
    const mark = node.marks.find((m) => m.type.name === "revision_format");
    if (mark)
      found.push({
        from: pos,
        to: pos + node.nodeSize,
        log: mark.attrs as FormatLog,
      });
  });
  return found;
}
export function resolveFormattingChanges(
  state: EditorState,
  ids: ReadonlySet<string>,
  decision: "accept" | "reject",
) {
  const tr = closeHistory(state.tr).setMeta("reviewDecision", true);
  for (const { from, to, log } of formattingChanges(state.doc)) {
    if (
      !log.records.some(
        (record) => record.status === "pending" && ids.has(record.stamp.id),
      )
    )
      continue;
    const records = log.records.map((record) =>
      record.status === "pending" && ids.has(record.stamp.id)
        ? {
            ...record,
            status:
              decision === "accept"
                ? ("accepted" as const)
                : ("rejected" as const),
          }
        : record,
    );
    const next = { base: log.base, records };
    const keep = records.some((record) => record.status === "pending");
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isInline) return;
      const end = Math.min(to, pos + node.nodeSize),
        start = Math.max(from, pos);
      const reviews = node.marks.filter((mark) =>
        isRevisionMark(mark.type.name),
      );
      tr.removeMark(start, end);
      for (const mark of [...formatMarks(state.schema, next), ...reviews])
        tr.addMark(start, end, mark);
      if (keep)
        tr.addMark(start, end, state.schema.marks.revision_format.create(next));
      return false;
    });
  }
  return tr;
}
export function formatReviewDocument(doc: PMNode, view: ReviewView): PMNode {
  if (view === "markup") return doc;
  const walk = (node: PMNode): PMNode => {
    const review = node.marks.find((m) => m.type.name === "revision_format");
    let result = node;
    if (review)
      result = node.mark([
        ...formatMarks(
          doc.type.schema,
          review.attrs as FormatLog,
          view === "original",
        ),
        ...node.marks.filter((m) => isRevisionMark(m.type.name)),
      ]);
    if (node.isLeaf) return result;
    const children: PMNode[] = [];
    node.forEach((child) => children.push(walk(child)));
    return result.copy(Fragment.fromArray(children));
  };
  return walk(doc);
}
