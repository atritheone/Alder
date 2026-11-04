import { Fragment, type Node as PMNode } from "prosemirror-model";
import { EditorState, TextSelection, type Transaction } from "prosemirror-state";
import { closeHistory } from "prosemirror-history";
import {
  validRevisionStamp,
  type RevisionStamp,
  type ReviewView,
} from "./trackedChanges";
import { validBlockChange } from "./trackedBlockChanges";
import { isTableCell, validateTableColumnChanges } from './trackedTableColumns';
import type { DocNode } from "./types";
import { captionMoveRange } from "./captionAnchors";
import { normaliseListOrders } from "./listFormatting";
import { CellSelection, TableMap } from 'prosemirror-tables';
import { tableRowBoundary } from './tableStructure';

const movableObject = (node: PMNode) =>
  ["inline_image", "equation", "shape", "form_field", "text_box", "document_note", "document_field", "cross_reference", "index_entry", "citation", "sequence", "bookmark", "bookmark_end", "comment_anchor"].includes(node.type.name);
const movableInline = (node: PMNode) =>
  node.isText || node.type.name === "hard_break" || movableObject(node);
const listBlock = (node: PMNode) => ["ordered_list", "bullet_list"].includes(node.type.name);
const structuralBlock = (node: PMNode) => listBlock(node) || ['table','table_row','list_item'].includes(node.type.name) || isTableCell(node);
const listStructure = (node: PMNode) => structuralBlock(node) || ["list_item", "paragraph", "table_row", "table_cell", "table_header"].includes(node.type.name);
const movableIdentity = (node: PMNode) => movableObject(node) || listStructure(node);
function permittedMoveChild(root: PMNode, child: PMNode) {
  if (!structuralBlock(root) && root.type.name !== 'table_row') return movableInline(child);
  return (movableInline(child) || listStructure(child)) &&
    !child.attrs.revisionMove && !child.attrs.revisionBlock && !child.attrs.revisionProperties && !child.attrs.captionLabel;
}
type ObjectIdentity = { id: string | null; body?: DocNode };
function noteIdentities(body: DocNode, next: () => string | null): DocNode {
  return {
    ...body,
    ...(body.attrs && { attrs: { ...body.attrs, ...(Object.hasOwn(body.attrs, "blockId") && { blockId: next() }) } }),
    ...(body.content && { content: body.content.map(child => noteIdentities(child, next)) }),
  };
}
const objectIdentities = (node: PMNode) => {
  const ids: ObjectIdentity[] = [];
  node.forEach((child) => {
    if (movableIdentity(child)) ids.push({ id: child.attrs.blockId, ...(child.type.name === "document_note" && { body: child.attrs.body }) });
    if (listStructure(child)) ids.push(...objectIdentities(child));
  });
  return ids;
};
function withObjectIdentities(node: PMNode, identities: ObjectIdentity[], aliases: ReadonlyMap<string, string> = new Map()) {
  let index = 0;
  const walk = (parent: PMNode): PMNode => {
    const children: PMNode[] = [];
    parent.forEach((child) => {
      const identity = movableIdentity(child) ? identities[index++] : undefined;
      const content = listStructure(child) ? walk(child).content : child.content;
      children.push(
        movableIdentity(child)
          ? child.type.create(
              { ...child.attrs, blockId: identity?.id ?? null,
                ...(child.type.name === "bookmark_end" && { targetId: aliases.get(child.attrs.targetId) || child.attrs.targetId }),
                ...(child.type.name === "document_note" && { body: identity?.body ?? noteIdentities(child.attrs.body, () => null) }),
              },
              content,
              child.marks,
            )
          : child,
      );
    });
    return parent.copy(Fragment.fromArray(children));
  };
  return walk(node);
}
function withoutFieldResults(node: PMNode): PMNode {
  if (listBlock(node) && node.attrs.continuePrevious)
    node = node.type.create({ ...node.attrs, order: 1 }, node.content, node.marks);
  if (node.type.name === "citation")
    return node.type.create({ ...node.attrs, renderedStyle: "apa" }, null, node.marks);
  if (node.type.name === "sequence") return node.type.create(node.attrs, null, node.marks);
  if (["document_field", "cross_reference"].includes(node.type.name))
    return node.type.create({ ...node.attrs, unresolved: false }, null, node.marks);
  if (node.isLeaf) return node;
  const children: PMNode[] = [];
  node.forEach(child => children.push(withoutFieldResults(child)));
  return node.copy(Fragment.fromArray(children));
}
const moveKey = (move: BlockMove) => `${move.stamp.id}:${move.part ?? 0}`;
function movedObjects(doc: PMNode) {
  return new Map(
    blockMoveChanges(doc)
      .filter(({ move }) => move.kind === "insertion" && move.stamp.move)
      .map(({ node, move }) => [moveKey(move), objectIdentities(node)]),
  );
}

function objectAliases(doc: PMNode | Fragment) {
  const changes = blockMoveChanges(doc), targets = new Map(
    changes.filter(({ move }) => move.stamp.move && move.kind === "insertion")
      .map(({ node, move }) => [moveKey(move), objectIdentities(node)]),
  );
  const roots = new Map(changes.filter(({ move }) => move.stamp.move && move.kind === "insertion").map(({ node, move }) => [moveKey(move), node.attrs.blockId]));
  const aliases = new Map<string, string>();
  for (const { node, move } of changes) {
    if (!move.stamp.move || move.kind !== "deletion") continue;
    const root = roots.get(moveKey(move));
    if (node.attrs.blockId && root) aliases.set(node.attrs.blockId, root);
    const live = targets.get(moveKey(move)) || [];
    objectIdentities(node).forEach((identity, index) => {
      if (identity.id && live[index]?.id) aliases.set(identity.id, live[index].id!);
    });
  }
  return aliases;
}

const captionTarget = (node: PMNode, aliases: ReadonlyMap<string, string>) =>
  aliases.get(node.attrs.captionTargetId) || node.attrs.captionTargetId;

function requireCompleteBookmarks(nodes: PMNode[]) {
  const starts = new Map<string, { range: boolean; order: number }>(), ends = new Map<string, number[]>();
  let order = 0;
  for (const node of nodes) node.descendants(child => {
    order++;
    if (child.type.name === "bookmark") starts.set(child.attrs.blockId, { range: child.attrs.range, order });
    if (child.type.name === "bookmark_end") ends.set(child.attrs.targetId, [...(ends.get(child.attrs.targetId) || []), order]);
  });
  if ([...starts].some(([id, start]) => start.range && ends.get(id)?.length !== 1) || [...ends].some(([id, end]) => !starts.has(id) || end.length !== 1 || end[0] <= starts.get(id)!.order))
    throw Error("Move the complete bookmarked passage, including both ends. The document has not changed.");
}

function requireCompleteComments(nodes: PMNode[]) {
  const threads = new Map<string, PMNode[]>();
  for (const node of nodes) node.descendants(child => {
    if (child.type.name === 'comment_anchor')
      threads.set(child.attrs.threadId, [...(threads.get(child.attrs.threadId) || []), child]);
  });
  for (const anchors of threads.values()) {
    if (anchors.length !== 2 || anchors[0].attrs.edge !== 'start' || anchors[1].attrs.edge !== 'end' ||
      JSON.stringify(anchors[0].attrs.thread) !== JSON.stringify(anchors[1].attrs.thread))
      throw Error('Move the complete commented passage, including both ends. The document has not changed.');
  }
}

export type BlockMove = {
  kind: "insertion" | "deletion";
  stamp: RevisionStamp;
  originalId: string | null;
  part?: number;
  count?: number;
};
export function validBlockMove(value: any): value is BlockMove {
  return (
    !!value &&
    ["insertion", "deletion"].includes(value.kind) &&
    validRevisionStamp(value.stamp) &&
    value.stamp.move === true &&
    Number.isInteger(value.count ?? 1) &&
    (value.count ?? 1) > 0 &&
    (value.count ?? 1) <= 100000 &&
    Number.isInteger(value.part ?? 0) &&
    (value.part ?? 0) >= 0 &&
    (value.part ?? 0) < (value.count ?? 1) &&
    (value.originalId === null ||
      (typeof value.originalId === "string" &&
        /^[A-Za-z0-9_.-]{1,128}$/.test(value.originalId)))
  );
}
export function parseBlockMove(value: string | null): BlockMove | null {
  if (!value) return null;
  const parsed = JSON.parse(value);
  if (!validBlockMove(parsed)) throw Error("Invalid tracked paragraph move.");
  return parsed;
}
export function blockMoveChanges(doc: PMNode | Fragment) {
  const changes: { node: PMNode; pos: number; move: BlockMove; parent: PMNode | null }[] = [];
  doc.descendants((node, pos, parent) => {
    if (node.attrs.revisionMove || node.attrs.revisionBlock)
      changes.push({
        node,
        pos,
        parent,
        move: node.attrs.revisionMove || node.attrs.revisionBlock,
      });
  });
  return changes;
}
export function validateBlockMoves(doc: PMNode | Fragment) {
  doc.descendants(node=>{
    if(!listBlock(node))return;
    let changed=false,unchanged=false;
    node.forEach(item=>{if(item.attrs.revisionBlock||item.attrs.revisionMove)changed=true;else unchanged=true;});
    if(changed&&!unchanged)throw Error('Tracked list items must retain an unchanged item in the list.');
  });
  doc.descendants(table=>{
    if(table.type.name!=='table')return;
    if(table.attrs.revisionBlock && TableMap.get(table).problems?.length)
      throw Error('A tracked table must retain a complete grid.');
    const rows:PMNode[]=[];table.forEach(row=>rows.push(row));
    const revision=(row:PMNode|undefined)=>row?.attrs.revisionMove || row?.attrs.revisionBlock;
    if(!rows.some(row=>revision(row)))return;
    const map=TableMap.get(table);
    const group=(index:number)=>{const move=revision(rows[index]);return move?`${move.stamp.id}:${move.kind}`:null;};
    if(map.problems?.length || !rows.some(row=>!revision(row)) || rows.some((row,index)=>revision(row)&&(
      (group(index-1)!==group(index)&&!tableRowBoundary(map,index)) ||
      (group(index+1)!==group(index)&&!tableRowBoundary(map,index+1)))))
      throw Error('Tracked row changes must retain a complete grid and an unchanged row.');
  });
  const aliases = objectAliases(doc);
  const groups = new Map<string, ReturnType<typeof blockMoveChanges>>();
  for (const entry of blockMoveChanges(doc)) {
    const { node, move } = entry;
    if (
      !(node.attrs.revisionMove
        ? validBlockMove(move)
        : validBlockChange(move)) ||
      !!(node.attrs.revisionMove && node.attrs.revisionBlock) ||
      !(["paragraph", "heading"].includes(node.type.name) || structuralBlock(node)) ||
      node.attrs.revisionProperties
    )
      throw Error("Invalid tracked paragraph move.");
    node.descendants((child) => {
      if (
        (!(move.stamp.move || structuralBlock(node)
          ? permittedMoveChild(node, child)
          : child.isText || child.type.name === "hard_break") &&
          !(child.type.name === "comment_anchor" && !move.stamp.move && node.type.name!=='table_row')) ||
        child.marks.some((m) => m.type.name.startsWith("revision_"))
      )
        throw Error(
          "Review moves with unsupported contents or overlapping changes before importing.",
        );
    });
    const group = groups.get(move.stamp.id) || [];
    group.push(entry);
    groups.set(move.stamp.id, group);
  }
  validateTableColumnChanges(doc);
  for (const group of groups.values()) {
    const count = group[0].move.count ?? 1;
    if(group.some(entry=>entry.node.type.name==='table_row') &&
      (!group.every(entry=>entry.node.type.name==='table_row') || group[0].parent?.type.name!=='table' ||
       group.some(entry=>entry.parent!==group[0].parent)))
      throw Error('A tracked row move must stay within one complete table.');
    if(group.some(entry=>entry.node.type.name==='list_item') &&
      (!group.every(entry=>entry.node.type.name==='list_item') || !group[0].parent || !listBlock(group[0].parent) ||
       group.some(entry=>entry.parent!==group[0].parent)))
      throw Error('A tracked item move must stay within one list.');
    if (group.some((e) => !!e.move.stamp.move !== !!group[0].move.stamp.move))
      throw Error("Paragraph moves and changes need separate identities.");
    if (!group[0].move.stamp.move) {
      const rows=group.every(entry=>entry.node.type.name==='table_row');
      const items=group.every(entry=>entry.node.type.name==='list_item');
      const columns=group.every(entry=>isTableCell(entry.node));
      if(columns)for(const entry of group){requireCompleteBookmarks([entry.node]);requireCompleteComments([entry.node]);}
      if(rows || items || group.every(entry=>entry.node.type.name==='table' || listBlock(entry.node))){
        requireCompleteBookmarks(group.map(entry=>entry.node));
        requireCompleteComments(group.map(entry=>entry.node));
      }
      if (
        (!rows && !items && !columns && count!==1) ||
        group.length !== count ||
        group.some(
          (e, i) =>
            e.move.stamp.move ||
            e.move.kind !== group[0].move.kind ||
            e.move.stamp.author !== group[0].move.stamp.author ||
            e.move.stamp.date !== group[0].move.stamp.date ||
            (e.move.part ?? 0) !== i ||
            (e.move.count ?? 1) !== count ||
            (!columns && i > 0 && group[i - 1].pos + group[i - 1].node.nodeSize !== e.pos),
        )
      )
        throw Error(
          "A tracked paragraph change must retain its complete sequence.",
        );
      continue;
    }
    if(group.some(entry=>isTableCell(entry.node)))throw Error('Individual table cells cannot carry a tracked move.');
    const sides = ["deletion", "insertion"].map((kind) =>
      group.filter((e) => e.move.kind === kind),
    );
    for (const side of sides) {
      requireCompleteBookmarks(side.map(entry => entry.node));
      requireCompleteComments(side.map(entry => entry.node));
    }
    if (
      sides.some(
        (side) =>
          side.length !== count ||
          side.some(
            (entry, i) =>
              (entry.move.part ?? 0) !== i ||
              (entry.move.count ?? 1) !== count ||
              (i > 0 &&
                side[i - 1].pos + side[i - 1].node.nodeSize !== entry.pos),
          ),
      )
    )
      throw Error(
        "Copy both complete sides of a tracked paragraph move, or review it first.",
      );
    for (let i = 0; i < count; i++) {
      const [a, b] = sides.map((side) => side[i]);
      if (
        a.move.originalId !== b.move.originalId ||
        a.move.stamp.author !== b.move.stamp.author ||
        a.move.stamp.date !== b.move.stamp.date ||
        a.move.stamp.author !== group[0].move.stamp.author ||
        a.move.stamp.date !== group[0].move.stamp.date
      )
        throw Error(
          "Both sides of a paragraph move must retain the same identity and author.",
        );
      const clean = (node: PMNode) =>
        node.type.create(
          { ...node.attrs, blockId: null, revisionMove: null, captionTargetId: captionTarget(node, aliases), ...(listBlock(node) && node.attrs.continuePrevious && { order: 1 }) },
          withoutFieldResults(withObjectIdentities(node, [], aliases)).content,
          node.marks,
        );
      if (!clean(a.node).eq(clean(b.node)))
        throw Error(
          "A paragraph move must retain the same contents and formatting at both ends.",
        );
    }
  }
}
export function trackBlockMove(
  state: EditorState,
  source: Transaction,
  stamp: RevisionStamp,
) {
  const move = source.getMeta("arrangementMove");
  if (!["paragraph", "section", "row", "item"].includes(move?.kind)) return null;
  const node = state.doc.nodeAt(move.from),
    at = state.doc.resolve(move.from),
    target = state.doc.resolve(move.destination);
  if (
    !node ||
    (['row','item'].includes(move.kind)
      ? (move.kind==='row'?node.type.name!=='table_row' || at.parent.type.name!=='table':node.type.name!=='list_item' || !listBlock(at.parent)) || target.parent!==at.parent || state.doc.resolve(move.to).parent!==at.parent
      : at.depth !== 0 || target.depth !== 0 || state.doc.resolve(move.to).depth !== 0) ||
    (move.kind === "paragraph" && node.nodeSize !== move.to - move.from)
  )
    throw Error(
      "Track complete body paragraphs. The document has not changed.",
    );
  const range = ['row','item'].includes(move.kind)?{from:move.from,to:move.to}:captionMoveRange(state.doc, move.from, move.to);
  if (move.destination >= range.from && move.destination <= range.to)
    return state.tr.setMeta("trackedEdit", stamp.id);
  const nodes: PMNode[] = [];
  state.doc.slice(range.from, range.to).content.forEach((n) => nodes.push(n));
  requireCompleteBookmarks(nodes);
  requireCompleteComments(nodes);
  if (nodes.some((n) => !["paragraph", "heading"].includes(n.type.name) && !structuralBlock(n)))
    throw Error(
      "Review moves containing section boundaries or unsupported objects separately. The document has not changed.",
    );
  const tr = closeHistory(state.tr),
    copies: PMNode[] = [];
  const ghostIds = nodes.map(node => objectIdentities(node).map(identity => ({ id: `block_${crypto.randomUUID()}`, ...(identity.body && { body: noteIdentities(identity.body, () => `block_${crypto.randomUUID()}`) }) })));
  const ghostRoots = nodes.map(() => `block_${crypto.randomUUID()}`);
  const aliases = new Map<string, string>();
  nodes.forEach((node, part) => { if (node.attrs.blockId) aliases.set(node.attrs.blockId, ghostRoots[part]); });
  nodes.forEach((node, part) => objectIdentities(node).forEach((identity, index) => {
    if (identity.id) aliases.set(identity.id, ghostIds[part][index].id);
  }));
  let pos = range.from;
  for (const [part, node] of nodes.entries()) {
    if (
      node.attrs.revisionProperties ||
      node.attrs.revisionMove ||
      node.attrs.revisionBlock
    )
      throw Error("Review this paragraph’s existing changes before moving it.");
    node.descendants((child) => {
      if (
        !permittedMoveChild(node, child) ||
        child.marks.some((m) => m.type.name.startsWith("revision_"))
      )
        throw Error(
          "Review paragraph moves containing objects separately. The document has not changed.",
        );
    });
    const paired = {
      stamp: { ...stamp, move: true },
      originalId: node.attrs.blockId || null,
      ...(nodes.length > 1 ? { part, count: nodes.length } : {}),
    };
    const ghost = withObjectIdentities(
      node,
      ghostIds[part],
      aliases,
    );
    tr.replaceWith(
      pos,
      pos + node.nodeSize,
      ghost.type.create(
        {
          ...node.attrs,
          captionTargetId: captionTarget(node, aliases),
          blockId: ghostRoots[part],
          revisionMove: { ...paired, kind: "deletion" },
        },
        ghost.content,
        ghost.marks,
      ),
    );
    copies.push(
      node.type.create(
        { ...node.attrs, revisionMove: { ...paired, kind: "insertion" } },
        node.content,
        node.marks,
      ),
    );
    pos += node.nodeSize;
  }
  tr.insert(move.destination, Fragment.fromArray(copies));
  if(move.kind==='row'){
    const last=move.destination+copies.slice(0,-1).reduce((sum,row)=>sum+row.nodeSize,0);
    tr.setSelection(CellSelection.rowSelection(tr.doc.resolve(move.destination+1),tr.doc.resolve(last+1)));
    tr.setMeta('structuralReview',true);
  }
  if(move.kind==='item'){
    tr.setSelection(TextSelection.between(tr.doc.resolve(move.destination+state.selection.from-range.from),tr.doc.resolve(move.destination+state.selection.to-range.from)));
    tr.setMeta('structuralReview',true);
  }
  validateBlockMoves(tr.doc);
  return tr.setMeta("trackedEdit", stamp.id);
}
export function resolveBlockMoves(
  state: EditorState,
  ids: ReadonlySet<string>,
  decision: "accept" | "reject",
) {
  const tr = closeHistory(state.tr);
  const objects = movedObjects(state.doc);
  const aliases = objectAliases(state.doc);
  for (const { node, pos, move } of blockMoveChanges(state.doc).reverse()) {
    if (!ids.has(move.stamp.id)) continue;
    if (move.kind === (decision === "accept" ? "deletion" : "insertion"))
      tr.delete(pos, pos + node.nodeSize);
    else
      tr.replaceWith(
        pos,
        pos + node.nodeSize,
        node.type.create(
          {
            ...node.attrs,
            captionTargetId: captionTarget(node, aliases),
            blockId: move.originalId,
            revisionMove: null,
            revisionBlock: null,
          },
          withObjectIdentities(
            node,
            objects.get(moveKey(move)) || objectIdentities(node),
            aliases,
          ).content,
          node.marks,
        ),
      );
  }
  return tr;
}
export function blockMoveView(doc: PMNode, view: ReviewView): PMNode {
  if (view === "markup") return doc;
  const objects = movedObjects(doc);
  const aliases = objectAliases(doc);
  const walk = (node: PMNode): PMNode | null => {
    const move = (node.attrs.revisionMove ||
      node.attrs.revisionBlock) as BlockMove | null;
    if (move?.kind === (view === "final" ? "deletion" : "insertion"))
      return null;
    if (node.isLeaf) return node;
    const children: PMNode[] = [];
    node.forEach((c) => {
      const result = walk(c);
      if (result) children.push(result);
    });
    if (['doc','table_cell','table_header'].includes(node.type.name) && !children.length)
      children.push(node.type.schema.nodes.paragraph.create());
    const restored = move?.stamp.move
      ? withObjectIdentities(node, objects.get(moveKey(move)) || [], aliases)
      : node;
    return node.type.create(
      move
        ? {
            ...node.attrs,
            captionTargetId: captionTarget(node, aliases),
            blockId: move.originalId,
            revisionMove: null,
            revisionBlock: null,
          }
        : node.attrs,
      move?.stamp.move ? restored.content : children,
      node.marks,
    );
  };
  return normaliseListOrders(walk(doc)!);
}
