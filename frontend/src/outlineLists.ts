import { formatPageNumber } from "./pageNumbering";
import { DOMSerializer, type Node as PMNode } from "prosemirror-model";
import { Plugin, type Command, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { closeHistory } from "prosemirror-history";
import {
  numberedMarkers,
  bulletMarkers,
  setListFormatting,
} from "./listFormatting";

export type ListLevel = {
  format: string;
  pattern: string;
  start: number;
  restart: number;
  indent: number;
  hanging: number;
};
export type ListTemplate = ListLevel[];
export const defaultListTemplate = (): ListTemplate =>
  Array.from({ length: 9 }, (_, i) => ({
    format: "decimal",
    pattern:
      Array.from({ length: i + 1 }, (_, n) => `%${n + 1}`).join(".") + ".",
    start: 1,
    restart: i,
    indent: 24 * (i + 1),
    hanging: 18,
  }));
export function validListTemplate(value: unknown): value is ListTemplate {
  return (
    Array.isArray(value) &&
    value.length === 9 &&
    value.every(
      (v, i) =>
        v &&
        typeof v === "object" &&
        !Object.keys(v).some(
          (k) =>
            ![
              "format",
              "pattern",
              "start",
              "restart",
              "indent",
              "hanging",
            ].includes(k),
        ) &&
        [...numberedMarkers, ...bulletMarkers].includes(v.format) &&
        typeof v.pattern === "string" &&
        v.pattern.length > 0 &&
        v.pattern.length <= 80 &&
        !/[\r\n\t\x00-\x1f]/u.test(v.pattern) &&
        ![...v.pattern.matchAll(/%(\d)/gu)].some(
          (m) =>
            Number(m[1]) < 1 ||
            Number(m[1]) > i + 1 ||
            (bulletMarkers as readonly string[]).includes(v.format),
        ) &&
        Number.isInteger(v.start) &&
        v.start >= 1 &&
        v.start <= 100000 &&
        Number.isInteger(v.restart) &&
        v.restart >= 0 &&
        v.restart <= i &&
        Number.isFinite(v.indent) &&
        v.indent >= 0 &&
        v.indent <= 288 &&
        Number.isFinite(v.hanging) &&
        v.hanging >= 0 &&
        v.hanging <= Math.min(144, v.indent),
    )
  );
}
export function parseListTemplate(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return validListTemplate(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
const isList = (node: PMNode) =>
  node.type.name === "ordered_list" || node.type.name === "bullet_list";
const isSeparateScope = (node: PMNode) =>
  ["table_cell", "table_header"].includes(node.type.name);
export function selectedOutlineList(state: EditorState, currentOnly = false) {
  const { $from, $to } = state.selection;
  let result: { node: PMNode; pos: number; level: number } | undefined,
    level = 0;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (isSeparateScope(node)) break;
    if (isList(node) && $to.pos <= $from.after(depth)) {
      result={ node, pos: $from.before(depth), level: level++ };
      if(node.attrs.listTemplate||currentOnly)break;
    }
  }
  return result;
}
export function listNumber(value: number, format: string): string {
  const bullets: Record<string, string> = {
    disc: "•",
    circle: "○",
    square: "▪",
  };
  if (bullets[format]) return bullets[format];
  const formats = {
    "lower-alpha": "lowerLetter",
    "upper-alpha": "upperLetter",
    "lower-roman": "lowerRoman",
    "upper-roman": "upperRoman",
  } as const;
  return formatPageNumber(
    value,
    formats[format as keyof typeof formats] || "decimal",
  );
}
export function nextListLabel(
  template: ListTemplate,
  counts: (number | null)[],
  level: number,
) {
  const current = template[level];
  counts[level] = counts[level] == null ? current.start : counts[level]! + 1;
  for (let i = level + 1; i < 9; i++)
    if (template[i].restart > 0 && level < template[i].restart)
      counts[i] = null;
  return current.pattern.replace(/%([1-9])/gu, (_, n) => {
    const index = Number(n) - 1;
    return index <= level
      ? listNumber(
          counts[index] ?? template[index].start,
          template[index].format,
        )
      : "";
  });
}
type Listing = { pos: number; node: PMNode; level: number; left: number };
type Marker = { pos: number; label: string; hanging: number; level: number };
type Layout = { lists: Listing[]; markers: Marker[]; tooDeep: boolean };
const layouts = new WeakMap<PMNode, Layout>();
/** Numbering is derived from semantic list order, never written into prose. */
export function outlineListLayout(doc: PMNode): Layout {
  const cached = layouts.get(doc);
  if (cached) return cached;
  const result: Layout = { lists: [], markers: [], tooDeep: false };
  const ghosts: { pos: number; node: PMNode; key: string }[] = [];
  const destinations = new Map<string, { pos: number; lists: Listing[]; markers: Marker[] }>();
  const scope = (parent: PMNode, start: number) => {
    const previous = new Map<string, (number | null)[]>();
    parent.forEach((node, offset) => {
      const deleted = node.attrs.revisionBlock?.kind === 'deletion';
      const pos = start + offset,
        template = node.attrs.listTemplate;
      const move = node.attrs.revisionMove;
      const moveKey = move && `${move.stamp.id}:${move.part ?? 0}`;
      if (move?.kind === "deletion") {
        if (isList(node) && validListTemplate(template)) ghosts.push({ pos, node, key: moveKey });
        return;
      }
      if (isList(node) && validListTemplate(template)) {
        const firstList = result.lists.length, firstMarker = result.markers.length;
        const key = JSON.stringify(template),
          counts =
            node.attrs.continuePrevious && previous.has(key)
              ? [...previous.get(key)!]
              : Array<number | null>(9).fill(null);
        if (!node.attrs.continuePrevious || !previous.has(key))
          counts[0] = (node.attrs.order || template[0].start) - 1;
        const visit = (listing: PMNode, position: number, level: number) => {
          if (level >= 9) {
            result.tooDeep = true;
            return;
          }
          result.lists.push({
            node: listing,
            pos: position,
            level,
            left:
              template[level].indent - (level ? template[level - 1].indent : 0),
          });
          listing.forEach((item, itemOffset) => {
            const itemPos = position + 1 + itemOffset;
            const move=item.attrs.revisionMove,key=move&&`${move.stamp.id}:${move.part??0}`;
            if(move?.kind==='deletion'){ghosts.push({pos:itemPos,node:item,key});return;}
            const deletedCounts=item.attrs.revisionBlock?.kind==='deletion'?[...counts]:null;
            const firstList=result.lists.length,firstMarker=result.markers.length,
              label = nextListLabel(template, counts, level);
            result.markers.push({
              pos: itemPos + 2,
              label,
              hanging: template[level].hanging,
              level,
            });
            const nested = (node: PMNode, pos: number) => {
              if (isSeparateScope(node)) {
                scope(node, pos + 1);
                return;
              }
              if (isList(node)) {
                visit(node, pos, level + 1);
                return;
              }
              if (!node.isTextblock)
                node.forEach((child, offset) =>
                  nested(child, pos + 1 + offset),
                );
            };
            item.forEach((child, offset) =>
              nested(child, itemPos + 1 + offset),
            );
            if(key)destinations.set(key,{pos:itemPos,lists:result.lists.slice(firstList),markers:result.markers.slice(firstMarker)});
            if(deletedCounts)counts.splice(0,counts.length,...deletedCounts);
          });
        };
        visit(node, pos, 0);
        if (!deleted) previous.set(key, [...counts]);
        if (moveKey) destinations.set(moveKey, { pos, lists: result.lists.slice(firstList), markers: result.markers.slice(firstMarker) });
      } else if (!node.isTextblock) scope(node, pos + 1);
    });
  };
  scope(doc, 0);
  for (const ghost of ghosts) {
    const live = destinations.get(ghost.key);
    if (!live) continue;
    const shift = ghost.pos - live.pos;
    result.lists.push(...live.lists.map(list => ({ ...list, pos: list.pos + shift, node: doc.nodeAt(list.pos + shift)! })));
    result.markers.push(...live.markers.map(marker => ({ ...marker, pos: marker.pos + shift })));
  }
  result.lists.sort((a, b) => a.pos - b.pos);
  result.markers.sort((a, b) => a.pos - b.pos);
  layouts.set(doc, result);
  return result;
}
export function setListTemplate(
  template: ListTemplate | null,
  order: number,
  continuation: boolean,
  currentOnly = false,
): Command {
  return (state, dispatch) => {
    const root = selectedOutlineList(state,currentOnly);
    if (
      !root ||
      (template != null && !validListTemplate(template)) ||
      !Number.isInteger(order) ||
      order < 1 ||
      order > 100000
    )
      return false;
    const tr = closeHistory(state.tr).setNodeMarkup(root.pos, undefined, {
      ...root.node.attrs,
      listTemplate: template,
      order,
      continuePrevious: continuation,
    });
    const convertKinds=(node:PMNode,pos:number,level=0)=>{
      if(!template||isSeparateScope(node))return;
      if(isList(node)){
        if(level>=template.length)return;
        const name=(bulletMarkers as readonly string[]).includes(template[level].format)?'bullet_list':'ordered_list';
        const current=tr.doc.nodeAt(pos)!;
        if(current.type.name!==name)tr.setNodeMarkup(pos,state.schema.nodes[name],{...current.attrs,listStyle:null});
        level++;
      }
      if(!node.isTextblock)node.forEach((child,offset)=>convertKinds(child,pos+1+offset,level));
    };
    convertKinds(root.node,root.pos);
    {
      const sequence=(node:PMNode)=>node.attrs.listTemplate?JSON.stringify(node.attrs.listTemplate):`${node.type.name}:${node.attrs.listStyle||'decimal'}`;
      const source = sequence(root.node),
        at = state.doc.resolve(root.pos);
      let following = root.pos + root.node.nodeSize;
      for (let i = at.index() + 1; i < at.parent.childCount; i++) {
        const next = at.parent.child(i);
        if (
          isList(next) &&
          sequence(next) === source
        ) {
          if (!next.attrs.continuePrevious) break;
          tr.setNodeMarkup(following, undefined, {
            ...next.attrs,
            listTemplate: template,
          });
          convertKinds(next,following);
        }
        following += next.nodeSize;
      }
    }
    if (outlineListLayout(tr.doc).tooDeep) return false;
    if (dispatch) dispatch(tr);
    return true;
  };
}
export function applyListOptions(
  marker: string,
  order: number,
  fromItem: boolean,
  continuation: boolean,
  template: ListTemplate | null | undefined,
  currentOnly = false,
): Command {
  if (template) return setListTemplate(template, order, continuation,currentOnly);
  if (template === undefined)
    return setListFormatting(marker, order, fromItem, continuation);
  return (state, dispatch) => {
    const root = selectedOutlineList(state);
    if (!root) return false;
    let changed = state,
      cleared: any,
      formatted: any;
    if (
      !setListTemplate(
        null,
        root.node.attrs.order || 1,
        !!root.node.attrs.continuePrevious,
      )(state, (tr) => {
        cleared = tr;
        changed = state.apply(tr);
      })
    )
      return false;
    if (
      !setListFormatting(
        marker,
        order,
        fromItem,
        continuation,
      )(changed, (tr) => {
        formatted = tr;
      })
    )
      return false;
    if (dispatch) {
      const tr = closeHistory(state.tr);
      for (const step of [...cleared.steps, ...formatted.steps]) tr.step(step);
      tr.setSelection(formatted.selection.getBookmark().resolve(tr.doc));
      dispatch(tr);
    }
    return true;
  };
}
/** Ordinary list labels follow Word's repeated-letter and extended Roman
 * conventions too; CSS lower-alpha switches to spreadsheet-style AB. */
const ordinaryLayouts=new WeakMap<PMNode,{pos:number;node:PMNode;label:string}[]>();
export function ordinaryListLabels(doc: PMNode) {
  const cached=ordinaryLayouts.get(doc);if(cached)return cached;
  const labels: { pos: number; node: PMNode; label: string }[] = [];
  const ghosts:{pos:number;node:PMNode;key:string}[]=[],targets=new Map<string,{pos:number;node:PMNode}>();
  doc.descendants((node, pos) => {
    if (node.attrs.listTemplate) return false;
    if(node.type.name==='list_item'&&node.attrs.revisionMove){
      const move=node.attrs.revisionMove,key=`${move.stamp.id}:${move.part??0}`;
      if(move.kind==='deletion'){ghosts.push({pos,node,key});return false;}
      targets.set(key,{pos,node});
    }
    if(node.type.name!=='ordered_list')return;
    let reviewedItems=false;node.forEach(item=>{if(item.attrs.revisionMove||item.attrs.revisionBlock)reviewedItems=true;});
    if (
      (!reviewedItems && (!node.attrs.listStyle || node.attrs.listStyle === "decimal"))
    )
      return;
    let index=0;
    node.forEach((item, offset) => {
      if(item.attrs.revisionMove?.kind==='deletion')return;
      labels.push({
        pos: pos + 1 + offset,
        node: item,
        label:
          listNumber((node.attrs.order || 1) + index, node.attrs.listStyle||'decimal') +
          ". ",
      });
      if(item.attrs.revisionBlock?.kind!=='deletion')index++;
    });
  });
  const live=labels.slice().sort((a,b)=>a.pos-b.pos);
  for(const ghost of ghosts){
    const target=targets.get(ghost.key);if(!target)continue;
    const shift=ghost.pos-target.pos;
    let low=0,high=live.length;
    while(low<high){const middle=(low+high)>>>1;if(live[middle].pos<target.pos)low=middle+1;else high=middle;}
    for(let index=low;index<live.length&&live[index].pos<target.pos+target.node.nodeSize;index++){
      const label=live[index];labels.push({...label,pos:label.pos+shift,node:doc.nodeAt(label.pos+shift)!});
    }
  }
  labels.sort((a,b)=>a.pos-b.pos);
  ordinaryLayouts.set(doc,labels);
  return labels;
}

/** Static review previews need the same generated labels as the live editor. */
export function outlinePreviewFragment(doc: PMNode) {
  const serializer = DOMSerializer.fromSchema(doc.type.schema);
  const layout = outlineListLayout(doc);
  const lists = new Map(layout.lists.map(item => [item.node, item]));
  const markers = new Map(layout.markers.map(item => [doc.nodeAt(item.pos - 1)!, item]));
  const ordinary = new Map(ordinaryListLabels(doc).map(item => [item.node, item.label]));
  const nodes = { ...serializer.nodes };
  for (const name of ["ordered_list", "bullet_list", "list_item", "paragraph"]) {
    nodes[name] = node => {
      const rendered = DOMSerializer.renderSpec(document, serializer.nodes[name](node));
      const dom = rendered.dom as HTMLElement;
      const list = lists.get(node), marker = markers.get(node), label = ordinary.get(node);
      if (list) {
        dom.classList.add("outline-list");
        dom.style.cssText += `;list-style-type:none;padding-left:0;margin-left:${list.left * 4 / 3}px;margin-top:0;margin-bottom:0`;
      }
      if (label) dom.style.listStyleType = JSON.stringify(label);
      if (marker && rendered.contentDOM) {
        const number = document.createElement("span");
        number.className = "outline-list-number";
        number.dataset.outlineNumber = "true";
        number.textContent = marker.label + "\u00a0";
        number.style.cssText = `display:inline-block;white-space:pre;margin-left:${-marker.hanging * 4 / 3}px`;
        rendered.contentDOM.prepend(number);
      }
      return rendered;
    };
  }
  return new DOMSerializer(nodes, serializer.marks).serializeFragment(doc.content);
}
export function outlineLists(labels?: ReadonlyMap<number, string | null>) {
  let previous: PMNode | undefined, decorations: DecorationSet;
  return new Plugin({
    filterTransaction(tr) {
      return !tr.docChanged || !outlineListLayout(tr.doc).tooDeep;
    },
    props: {
      decorations(state) {
        if (previous === state.doc) return decorations;
        const layout = outlineListLayout(state.doc);
        decorations = DecorationSet.create(state.doc, [
          ...ordinaryListLabels(state.doc).map(({ pos, node, label }) =>
            Decoration.node(pos, pos + node.nodeSize, {
              style: `list-style-type:"${label}"`,
            }),
          ),
          ...layout.lists.map(({ pos, node, left }) =>
            Decoration.node(pos, pos + node.nodeSize, {
              class: "outline-list",
              style: `list-style-type:none;padding-left:0;margin-left:${(left * 4) / 3}px;margin-top:0;margin-bottom:0`,
            }),
          ),
          ...layout.markers
            .filter(({ pos }) => labels?.get(pos) !== null)
            .map((marker) => ({
              ...marker,
              label: labels?.get(marker.pos) ?? marker.label,
            }))
            .map(({ pos, label, hanging }) =>
              Decoration.widget(
                pos,
                () => {
                  const marker = document.createElement("span");
                  marker.className = "outline-list-number";
                  marker.dataset.outlineNumber = "true";
                  marker.textContent = label + "\u00a0";
                  marker.style.cssText = `display:inline-block;white-space:pre;margin-left:${(-hanging * 4) / 3}px;pointer-events:none`;
                  return marker;
                },
                {
                  side: -1,
                  key: `outline-${label}-${hanging}`,
                  ignoreSelection: true,
                },
              ),
            ),
        ]);
        previous = state.doc;
        return decorations;
      },
    },
  });
}
