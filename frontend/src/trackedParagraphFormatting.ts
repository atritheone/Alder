import { Fragment, type Node as PMNode, type Schema } from "prosemirror-model";
import { closeHistory } from "prosemirror-history";
import type { EditorState, Transaction } from "prosemirror-state";
import {
  validRevisionStamp,
  type RevisionStamp,
  type ReviewView,
} from "./trackedChanges";

type ParagraphAppearance = { type: string; attrs: Record<string, unknown> };
export type ParagraphFormatLog = {
  base: ParagraphAppearance;
  records: {
    stamp: RevisionStamp;
    status: "pending" | "accepted" | "rejected";
    before: ParagraphAppearance;
    after: ParagraphAppearance;
  }[];
};
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const appearance = (node: PMNode): ParagraphAppearance => ({
  type: node.type.name,
  attrs: Object.fromEntries(
    Object.entries(node.attrs).filter(
      ([key]) => !["blockId", "revisionProperties"].includes(key),
    ),
  ),
});
export function validParagraphFormatLog(
  value: unknown,
): value is ParagraphFormatLog {
  const log = value as ParagraphFormatLog;
  const valid = (p: ParagraphAppearance) =>
    p &&
    ["paragraph", "heading"].includes(p.type) &&
    p.attrs &&
    typeof p.attrs === "object" &&
    !Array.isArray(p.attrs) &&
    !("revisionProperties" in p.attrs) &&
    !("blockId" in p.attrs);
  return (
    !!log &&
    !!valid(log.base) &&
    Array.isArray(log.records) &&
    log.records.length > 0 &&
    log.records.length <= 1000 &&
    log.records.every(
      (r) =>
        r &&
        validRevisionStamp(r.stamp) &&
        ["pending", "accepted", "rejected"].includes(r.status) &&
        valid(r.before) &&
        valid(r.after),
    )
  );
}
export function paragraphFormat(
  log: ParagraphFormatLog,
  original = false,
): ParagraphAppearance {
  if (!validParagraphFormatLog(log))
    throw new Error("Invalid paragraph formatting revision.");
  let type = log.base.type;
  const attrs = { ...log.base.attrs };
  for (const record of log.records) {
    if (
      record.status === "rejected" ||
      (original && record.status === "pending")
    )
      continue;
    if (record.before.type !== record.after.type) type = record.after.type;
    for (const key of new Set([
      ...Object.keys(record.before.attrs),
      ...Object.keys(record.after.attrs),
    ])) {
      if (same(record.before.attrs[key], record.after.attrs[key])) continue;
      if (Object.hasOwn(record.after.attrs, key))
        Object.defineProperty(attrs, key, {
          value: record.after.attrs[key],
          enumerable: true,
          configurable: true,
          writable: true,
        });
      else delete attrs[key];
    }
  }
  return { type, attrs };
}

export function parseParagraphFormat(
  value: string | null,
): ParagraphFormatLog | null {
  try {
    const log = JSON.parse(value || "null");
    return validParagraphFormatLog(log) ? log : null;
  } catch {
    return null;
  }
}
export function trackParagraphFormatting(
  state: EditorState,
  tr: Transaction,
  stamp: RevisionStamp,
): Transaction | null {
  if (
    !tr.docChanged ||
    !validRevisionStamp(stamp) ||
    !state.schema.nodes.paragraph.spec.attrs?.revisionProperties
  )
    return null;
  const changed: { before: PMNode; after: PMNode; pos: number }[] = [];
  const compare = (before: PMNode, after: PMNode, pos: number): boolean => {
    if (before.eq(after)) return true;
    if (before.isLeaf || after.isLeaf) return false;
    if (
      ["paragraph", "heading"].includes(before.type.name) &&
      ["paragraph", "heading"].includes(after.type.name) &&
      before.content.eq(after.content)
    ) {
      changed.push({ before, after, pos });
      return true;
    }
    if (
      before.type !== after.type ||
      before.nodeSize !== after.nodeSize ||
      !same(before.attrs, after.attrs) ||
      before.childCount !== after.childCount ||
      !same(before.marks, after.marks)
    )
      return false;
    let valid = true;
    before.forEach((child, offset, index) => {
      if (valid)
        valid = compare(
          child,
          after.child(index),
          pos + (before.type.name === "doc" ? 0 : 1) + offset,
        );
    });
    return valid;
  };
  if (!compare(state.doc, tr.doc, 0) || !changed.length) return null;
  for (const { before, after, pos } of changed) {
    const old = appearance(before),
      next = appearance(after),
      log = before.attrs.revisionProperties as ParagraphFormatLog | null;
    const history = same(old, next)
      ? log
      : {
          base: log?.base || old,
          records: [
            ...(log?.records || []),
            { stamp, status: "pending", before: old, after: next },
          ],
        };
    tr.setNodeMarkup(pos, undefined, {
      ...after.attrs,
      blockId: before.attrs.blockId,
      revisionProperties: history,
    });
  }
  return tr.setMeta("trackedEdit", stamp.id);
}
export function paragraphFormattingChanges(doc: PMNode) {
  const found: { node: PMNode; pos: number; log: ParagraphFormatLog }[] = [];
  doc.descendants((node, pos) => {
    if (node.attrs.revisionProperties)
      found.push({ node, pos, log: node.attrs.revisionProperties });
  });
  return found;
}
function formattedNode(
  node: PMNode,
  log: ParagraphFormatLog,
  schema: Schema,
  original: boolean,
  keep: boolean,
) {
  const appearance = paragraphFormat(log, original),
    type = schema.nodes[appearance.type];
  return type.create(
    {
      ...appearance.attrs,
      blockId: node.attrs.blockId,
      revisionProperties: keep ? log : null,
    },
    node.content,
    node.marks,
  );
}
export function resolveParagraphFormatting(
  state: EditorState,
  ids: ReadonlySet<string>,
  decision: "accept" | "reject",
) {
  const tr = closeHistory(state.tr).setMeta("reviewDecision", true);
  for (const { node, pos, log } of paragraphFormattingChanges(state.doc)) {
    if (!log.records.some((r) => r.status === "pending" && ids.has(r.stamp.id)))
      continue;
    const next: ParagraphFormatLog = {
      ...log,
      records: log.records.map((r) =>
        r.status === "pending" && ids.has(r.stamp.id)
          ? { ...r, status: decision === "accept" ? "accepted" : "rejected" }
          : r,
      ),
    };
    const result = formattedNode(
      node,
      next,
      state.schema,
      false,
      next.records.some((r) => r.status === "pending"),
    );
    tr.setNodeMarkup(pos, result.type, result.attrs, result.marks);
  }
  return tr;
}
export function paragraphFormatView(doc: PMNode, view: ReviewView): PMNode {
  if (view === "markup") return doc;
  const walk = (node: PMNode): PMNode => {
    let result = node.attrs.revisionProperties
      ? formattedNode(
          node,
          node.attrs.revisionProperties,
          doc.type.schema,
          view === "original",
          false,
        )
      : node;
    if (node.isLeaf) return result;
    const children: PMNode[] = [];
    node.forEach((child) => children.push(walk(child)));
    return result.copy(Fragment.fromArray(children));
  };
  return walk(doc);
}
