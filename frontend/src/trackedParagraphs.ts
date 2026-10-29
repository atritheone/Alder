import {
  Fragment,
  type Node as PMNode,
  type NodeSpec,
} from "prosemirror-model";
import { type EditorState, type Transaction } from "prosemirror-state";
import { canJoin, ReplaceStep } from "prosemirror-transform";
import { closeHistory } from "prosemirror-history";
import {
  validRevisionStamp,
  type RevisionStamp,
  type ReviewView,
  reviewDocument,
} from "./trackedChanges";

/** A deleted paragraph boundary lives in the joined paragraph, retaining the
 * right paragraph's identity and formatting for rejection/original view. */
export function validRevisionBreak(value: any): boolean {
  return (
    !!value &&
    ["insertion", "deletion"].includes(value.kind) &&
    validRevisionStamp(value.stamp) &&
    (value.kind === "insertion"
      ? typeof value.nextId === "string" &&
        /^[A-Za-z0-9_.-]{1,128}$/.test(value.nextId)
      : ["paragraph", "heading"].includes(value.rightType) &&
        value.rightAttrs &&
        typeof value.rightAttrs === "object" &&
        !Array.isArray(value.rightAttrs))
  );
}
export const revisionBreakSpec: NodeSpec = {
  inline: true,
  group: "inline",
  atom: true,
  selectable: false,
  marks: "",
  attrs: {
    kind: {},
    stamp: {},
    nextId: { default: null },
    rightType: { default: null },
    rightAttrs: { default: null },
    blockId: { default: null },
  },
  toDOM: (node) => [
    "span",
    {
      "data-revision-break": node.attrs.kind,
      "data-revision-break-content": JSON.stringify(node.attrs),
      class: `document-revision-break ${node.attrs.kind}`,
      contenteditable: "false",
      "aria-label": `${node.attrs.kind === "insertion" ? "Inserted" : "Deleted"} paragraph break`,
    },
  ],
  parseDOM: [
    {
      tag: "span[data-revision-break]",
      priority: 80,
      getAttrs(dom) {
        try {
          const attrs = JSON.parse(
            dom.getAttribute("data-revision-break-content") || "null",
          );
          return validRevisionBreak(attrs) ? attrs : false;
        } catch {
          return false;
        }
      },
    },
  ],
};
const paragraph = (node: PMNode) =>
  ["paragraph", "heading"].includes(node.type.name);
export function trackParagraphTransaction(
  state: EditorState,
  tr: Transaction,
  stamp: RevisionStamp,
): Transaction | null {
  if (
    !validRevisionStamp(stamp) ||
    tr.steps.length !== 1 ||
    !(tr.steps[0] instanceof ReplaceStep)
  )
    return null;
  const step = tr.steps[0],
    source = state.doc,
    selection = tr.selection,
    count = tr.steps.length;
  const start = source.resolve(step.from),
    end = source.resolve(step.to);
  if (
    step.from === step.to &&
    step.slice.openStart === 1 &&
    step.slice.openEnd === 1 &&
    step.slice.content.childCount === 2 &&
    step.slice.size === 2 &&
    paragraph(start.parent)
  ) {
    const left = tr.doc.resolve(step.from),
      right = tr.doc.resolve(step.from + 2);
    if (
      !paragraph(right.parent) ||
      left.depth !== right.depth ||
      left.node(-1) !== right.node(-1)
    )
      return null;
    let existingBoundary = false;
    start.parent.forEach((child) => {
      if (
        child.type.name === "revision_break" &&
        child.attrs.kind === "insertion"
      )
        existingBoundary = true;
    });
    if (existingBoundary)
      throw new Error(
        "Review this paragraph's pending break before splitting it again. The document has not changed.",
      );
    const nextId = `block_${crypto.randomUUID()}`;
    tr.setNodeMarkup(right.before(), undefined, {
      ...right.parent.attrs,
      blockId: nextId,
    });
    tr.insert(
      step.from,
      state.schema.nodes.revision_break.create({
        kind: "insertion",
        stamp,
        nextId,
        blockId: `block_${crypto.randomUUID()}`,
      }),
    );
  } else if (
    !step.slice.size &&
    step.to - step.from === 2 &&
    paragraph(start.parent) &&
    paragraph(end.parent) &&
    start.parentOffset === start.parent.content.size &&
    end.parentOffset === 0 &&
    start.depth === end.depth &&
    start.node(-1) === end.node(-1) &&
    start.after() === end.before()
  ) {
    // A pending inserted boundary cancelled by the same author is simply gone.
    const marker = start.nodeBefore;
    if (
      marker?.type.name === "revision_break" &&
      marker.attrs.kind === "insertion" &&
      marker.attrs.stamp.author === stamp.author &&
      marker.attrs.nextId === end.parent.attrs.blockId
    ) {
      tr.delete(step.from - 1, step.from);
    } else {
      if (
        marker?.type.name === "revision_break" &&
        marker.attrs.kind === "insertion"
      )
        throw new Error(
          "Review the other author's paragraph break before joining these paragraphs. The document has not changed.",
        );
      tr.insert(
        step.from,
        state.schema.nodes.revision_break.create({
          kind: "deletion",
          stamp,
          rightType: end.parent.type.name,
          rightAttrs: end.parent.attrs,
          blockId: `block_${crypto.randomUUID()}`,
        }),
      );
    }
  } else return null;
  tr.setSelection(selection.map(tr.doc, tr.mapping.slice(count)));
  return tr.setMeta("trackedEdit", stamp.id);
}
export function paragraphChanges(doc: PMNode) {
  const changes: { node: PMNode; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "revision_break") changes.push({ node, pos });
  });
  return changes;
}
export function resolveParagraphChanges(
  state: EditorState,
  ids: ReadonlySet<string>,
  decision: "accept" | "reject",
) {
  const tr = closeHistory(state.tr).setMeta("reviewDecision", true);
  for (const { node, pos } of paragraphChanges(state.doc)
    .filter((item) => ids.has(item.node.attrs.stamp.id))
    .reverse()) {
    if (decision === "accept") {
      tr.delete(pos, pos + 1);
      continue;
    }
    if (node.attrs.kind === "insertion") {
      const at = tr.doc.resolve(pos),
        boundary = at.after(),
        next = tr.doc.nodeAt(boundary);
      if (
        next?.attrs.blockId !== node.attrs.nextId ||
        !canJoin(tr.doc, boundary)
      )
        throw new Error(
          "The two sides of this paragraph change have moved apart. Bring them together before rejecting the break.",
        );
      tr.delete(pos, pos + 1);
      tr.join(boundary - 1);
    } else {
      const type = state.schema.nodes[node.attrs.rightType];
      if (!type || !["paragraph", "heading"].includes(type.name))
        throw new Error("The original paragraph structure is unavailable.");
      tr.delete(pos, pos + 1);
      tr.split(pos, 1, [{ type, attrs: node.attrs.rightAttrs }]);
    }
  }
  return tr.scrollIntoView();
}
export function reviewParagraphDocument(doc: PMNode, view: ReviewView): PMNode {
  if (view === "markup") return doc;
  const joins = new WeakMap<PMNode, string>();
  const walk = (node: PMNode): PMNode[] => {
    if (node.type.name === "revision_break")
      return view === "original" ? [node] : [];
    if (node.isLeaf) return [node];
    const children: PMNode[] = [];
    node.forEach((child) => children.push(...walk(child)));
    if (node.isTextblock && view === "original") {
      const result: PMNode[] = [];
      let inline: PMNode[] = [],
        type = node.type,
        attrs = node.attrs,
        join: string | undefined;
      const finish = () => {
        const p = type.create(attrs, inline, node.marks);
        result.push(p);
        if (join) joins.set(p, join);
        inline = [];
        join = undefined;
      };
      for (const child of children) {
        if (child.type.name !== "revision_break") {
          inline.push(child);
          continue;
        }
        if (child.attrs.kind === "insertion") join = child.attrs.nextId;
        else {
          finish();
          type = doc.type.schema.nodes[child.attrs.rightType];
          attrs = child.attrs.rightAttrs;
        }
      }
      finish();
      return result;
    }
    const combined: PMNode[] = [];
    for (const child of children) {
      const prior = combined.at(-1),
        nextId = prior && joins.get(prior);
      if (!nextId) {
        combined.push(child);
        continue;
      }
      if (
        child.attrs.blockId !== nextId ||
        !prior!.isTextblock ||
        !child.isTextblock
      )
        throw new Error(
          "An original-view paragraph boundary has moved apart. Review the changes separately.",
        );
      const joined = prior!.copy(prior!.content.append(child.content));
      combined[combined.length - 1] = joined;
      const follow = joins.get(child);
      if (follow) joins.set(joined, follow);
    }
    if (combined.length && joins.has(combined.at(-1)!))
      throw new Error("An original-view paragraph boundary is incomplete.");
    return [node.copy(Fragment.fromArray(combined))];
  };
  return reviewDocument(walk(doc)[0], view);
}
