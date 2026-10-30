import { formatPageNumber } from "./pageNumbering";
import type { Node as PMNode } from "prosemirror-model";
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
export function selectedOutlineList(state: EditorState) {
  const { $from, $to } = state.selection;
  let result: { node: PMNode; pos: number; level: number } | undefined,
    level = 0;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (isSeparateScope(node)) break;
    if (isList(node) && $to.pos <= $from.after(depth)) {
      result = { node, pos: $from.before(depth), level: level++ };
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
  const scope = (parent: PMNode, start: number) => {
    const previous = new Map<string, (number | null)[]>();
    parent.forEach((node, offset) => {
      const pos = start + offset,
        template = node.attrs.listTemplate;
      if (isList(node) && validListTemplate(template)) {
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
            const itemPos = position + 1 + itemOffset,
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
          });
        };
        visit(node, pos, 0);
        previous.set(key, [...counts]);
      } else if (!node.isTextblock) scope(node, pos + 1);
    });
  };
  scope(doc, 0);
  layouts.set(doc, result);
  return result;
}
export function setListTemplate(
  template: ListTemplate | null,
  order: number,
  continuation: boolean,
): Command {
  return (state, dispatch) => {
    const root = selectedOutlineList(state);
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
    if (root.node.attrs.listTemplate) {
      const source = JSON.stringify(root.node.attrs.listTemplate),
        at = state.doc.resolve(root.pos);
      let following = root.pos + root.node.nodeSize;
      for (let i = at.index() + 1; i < at.parent.childCount; i++) {
        const next = at.parent.child(i);
        if (
          isList(next) &&
          JSON.stringify(next.attrs.listTemplate) === source
        ) {
          if (!next.attrs.continuePrevious) break;
          tr.setNodeMarkup(following, undefined, {
            ...next.attrs,
            listTemplate: template,
          });
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
): Command {
  if (template) return setListTemplate(template, order, continuation);
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
export function ordinaryListLabels(doc: PMNode) {
  const labels: { pos: number; node: PMNode; label: string }[] = [];
  doc.descendants((node, pos) => {
    if (node.attrs.listTemplate) return false;
    if (
      node.type.name !== "ordered_list" ||
      !node.attrs.listStyle ||
      node.attrs.listStyle === "decimal"
    )
      return;
    node.forEach((item, offset, index) =>
      labels.push({
        pos: pos + 1 + offset,
        node: item,
        label:
          listNumber((node.attrs.order || 1) + index, node.attrs.listStyle) +
          ". ",
      }),
    );
  });
  return labels;
}
export function outlineLists() {
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
          ...layout.markers.map(({ pos, label, hanging }) =>
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
