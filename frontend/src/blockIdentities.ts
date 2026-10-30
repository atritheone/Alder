import { Fragment, type Node as PMNode } from "prosemirror-model";
import { Plugin } from "prosemirror-state";

/** Identity belongs to a block, never its current position or page. */
export function identifiedDocument(doc: PMNode): PMNode {
  const seen = new Set<string>();
  const names = new Set<string>();
  const destinations = new Map<string, string>();
  const links = new Set<string>();
  const ranges = new Map<string, { id: string; name: string }>();
  const commentIds = new Set<string>(),
    commentCopies = new Map<string, string>();
  const walk = (node: PMNode): PMNode => {
    let result = node;
    if (node.type.name === "comment_anchor") {
      let id = node.attrs.threadId;
      if (node.attrs.edge === "start") {
        if (commentIds.has(id))
          commentCopies.set(id, `comment_${crypto.randomUUID()}`);
        else commentCopies.delete(id);
        commentIds.add(id);
      }
      id = commentCopies.get(id) || id;
      if (id !== node.attrs.threadId)
        result = node.type.create(
          { ...node.attrs, threadId: id },
          node.content,
          node.marks,
        );
    }
    if (Object.hasOwn(node.attrs, "blockId")) {
      const id = node.attrs.blockId;
      if (!id || seen.has(id))
        result = node.type.create(
          { ...result.attrs, blockId: `block_${crypto.randomUUID()}` },
          node.content,
          node.marks,
        );
      seen.add(result.attrs.blockId);
    }
    if (node.type.name === "bookmark") {
      let name = String(node.attrs.name),
        suffix = 1;
      const base = name;
      while (names.has(name.toLowerCase())) {
        const tail = `_${++suffix}`;
        name = base.slice(0, 40 - tail.length) + tail;
      }
      names.add(name.toLowerCase());
      if (name !== result.attrs.name)
        result = result.type.create(
          { ...result.attrs, name },
          result.content,
          result.marks,
        );
      destinations.set(name, result.attrs.blockId);
      if (node.attrs.blockId)
        ranges.set(node.attrs.blockId, { id: result.attrs.blockId, name });
    }
    if (node.type.name === "bookmark_end") {
      const target = ranges.get(node.attrs.targetId);
      if (
        target &&
        (target.id !== result.attrs.targetId ||
          target.name !== result.attrs.name)
      )
        result = result.type.create(
          { ...result.attrs, targetId: target.id, name: target.name },
          result.content,
          result.marks,
        );
    }
    for (const mark of node.marks)
      if (mark.type.name === "link" && mark.attrs.href?.startsWith("#"))
        links.add(mark.attrs.href.slice(1));
    if (node.type.name === "cross_reference") links.add(node.attrs.targetId);
    if (node.type.name === "index_entry" && node.attrs.rangeId) links.add(node.attrs.rangeId);
    if (node.type.name === "document_note") {
      const body = node.type.schema.nodeFromJSON(node.attrs.body),
        fixed = walk(body);
      if (fixed !== body)
        result = result.type.create(
          { ...result.attrs, body: fixed.toJSON() },
          result.content,
          result.marks,
        );
    }
    const children: PMNode[] = [];
    let changed = false;
    node.forEach((child) => {
      const next = walk(child);
      children.push(next);
      changed ||= next !== child;
    });
    return changed ? result.copy(Fragment.fromArray(children)) : result;
  };
  const identified = walk(doc);
  const bindings = new Map(
    [...links]
      .filter((target) => !seen.has(target) && destinations.has(target))
      .map((target) => [target, destinations.get(target)!]),
  );
  if (!bindings.size) return identified;
  const bind = (node: PMNode): PMNode => {
    const marks = node.marks.map((mark) =>
      mark.type.name === "link" && bindings.has(mark.attrs.href?.slice(1))
        ? mark.type.create({
            ...mark.attrs,
            href: "#" + bindings.get(mark.attrs.href.slice(1)),
          })
        : mark,
    );
    let result = marks.some((mark, i) => mark !== node.marks[i])
      ? node.mark(marks)
      : node;
    if(node.type.name==='index_entry' && bindings.has(node.attrs.rangeId))result=result.type.create({...result.attrs,rangeId:bindings.get(node.attrs.rangeId)},result.content,result.marks);
    if (
      node.type.name === "cross_reference" &&
      bindings.has(node.attrs.targetId)
    )
      result = result.type.create(
        { ...result.attrs, targetId: bindings.get(node.attrs.targetId) },
        result.content,
        result.marks,
      );
    const children: PMNode[] = [];
    let changed = false;
    node.forEach((child) => {
      const next = bind(child);
      children.push(next);
      changed ||= next !== child;
    });
    return changed ? result.copy(Fragment.fromArray(children)) : result;
  };
  return bind(identified);
}

export function blockIdentities() {
  return new Plugin({
    appendTransaction(transactions, _previous, state) {
      // Text-only edits cannot add or duplicate structural identities.
      if (
        !transactions.some(
          (tr) =>
            tr.docChanged &&
            tr.steps.some((step) => {
              const slice = (
                step as unknown as { slice?: { content: Fragment } }
              ).slice;
              let structural = false;
              slice?.content.descendants((node) => {
                if (node.isBlock || Object.hasOwn(node.attrs, "blockId"))
                  structural = true;
              });
              return structural;
            }),
        )
      )
        return null;
      const fixed = identifiedDocument(state.doc);
      if (fixed === state.doc) return null;
      const tr = state.tr.setMeta("blockIdentities", true);
      fixed.descendants((node, position) => {
        if (
          (Object.hasOwn(node.attrs, "blockId") &&
            (node.attrs.blockId !== state.doc.nodeAt(position)?.attrs.blockId ||
              node.attrs.targetId !==
                state.doc.nodeAt(position)?.attrs.targetId ||
              node.attrs.name !== state.doc.nodeAt(position)?.attrs.name)) ||
          (node.type.name === "document_note" &&
            node.attrs.body !== state.doc.nodeAt(position)?.attrs.body)
        )
          tr.setNodeMarkup(position, undefined, node.attrs);
        const before = state.doc.nodeAt(position);
        if (node.isInline && before && !node.sameMarkup(before)) {
          for (const mark of before.marks)
            if (!mark.isInSet(node.marks))
              tr.removeMark(position, position + node.nodeSize, mark);
          for (const mark of node.marks)
            if (!mark.isInSet(before.marks))
              tr.addMark(position, position + node.nodeSize, mark);
        }
      });
      return tr;
    },
  });
}
