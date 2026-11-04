import type { NodeSpec } from "prosemirror-model";
import { NodeSelection, type Command } from "prosemirror-state";
import { closeHistory } from "prosemirror-history";

export const shapeKinds = [
  "rectangle",
  "triangle",
  "diamond",
  "line",
  "arrow",
] as const;
export const shapeDefaults = {
  kind: "rectangle",
  width: 160,
  height: 80,
  strokeWidth: 1,
  stroke: "#253f60",
  fill: "#ffffff",
  alt: "",
  decorative: false,
};
export function shapeProperties(value: Record<string, unknown>) {
  if (
    Object.keys(value).some(
      (key) => key !== "blockId" && !(key in shapeDefaults),
    )
  )
    throw Error("Unsupported shape property.");
  const a = { ...shapeDefaults, blockId: null, ...value };
  if (!shapeKinds.includes(a.kind as (typeof shapeKinds)[number]))
    throw Error("Choose a supported shape.");
  for (const [key, min, max] of [
    ["width", 8, 2000],
    ["height", 8, 2000],
    ["strokeWidth", 0, 12],
  ] as const)
    if (
      typeof a[key] !== "number" ||
      !Number.isFinite(a[key]) ||
      a[key] < min ||
      a[key] > max
    )
      throw Error(`Invalid shape ${key}.`);
  if (a.strokeWidth >= Math.min(a.width, a.height))
    throw Error("The outline is too thick for this shape.");
  for (const key of ["stroke", "fill"] as const)
    if (
      !(key === "fill" && a[key] === "none") &&
      !/^#[\da-f]{6}$/i.test(a[key])
    )
      throw Error("Choose a shape colour.");
  if (
    typeof a.alt !== "string" ||
    a.alt.length > 4096 ||
    typeof a.decorative !== "boolean"
  )
    throw Error("Invalid shape description.");
  return a;
}
export function shapePath(value: Record<string, unknown>) {
  const a = shapeProperties(value),
    s = a.strokeWidth / 2,
    w = a.width - 2 * s,
    h = a.height - 2 * s;
  const points =
    a.kind === "line"
      ? [
          [s, s + h / 2],
          [s + w, s + h / 2],
        ]
      : a.kind === "triangle"
        ? [
            [s + w / 2, s],
            [s + w, s + h],
            [s, s + h],
          ]
        : a.kind === "diamond"
          ? [
              [s + w / 2, s],
              [s + w, s + h / 2],
              [s + w / 2, s + h],
              [s, s + h / 2],
            ]
          : a.kind === "arrow"
            ? [
                [s, s + h / 4],
                [s + w - Math.min(w, h) / 2, s + h / 4],
                [s + w - Math.min(w, h) / 2, s],
                [s + w, s + h / 2],
                [s + w - Math.min(w, h) / 2, s + h],
                [s + w - Math.min(w, h) / 2, s + (3 * h) / 4],
                [s, s + (3 * h) / 4],
              ]
            : [
                [s, s],
                [s + w, s],
                [s + w, s + h],
                [s, s + h],
              ];
  return (
    points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ") +
    (a.kind === "line" ? "" : " Z")
  );
}
export function shapeDOM(value: Record<string, unknown>) {
  const a = shapeProperties(value),
    dom = document.createElement("span"),
    ns = "http://www.w3.org/2000/svg";
  dom.dataset.documentShape = JSON.stringify(a);
  dom.dataset.shapeId = String(a.blockId || "");
  dom.contentEditable = "false";
  dom.setAttribute("role", a.decorative ? "presentation" : "img");
  if (a.decorative) dom.setAttribute("aria-hidden", "true");
  else dom.setAttribute("aria-label", a.alt || `${a.kind} shape`);
  dom.title = "Shape: double-click or press Enter to edit";
  dom.style.cssText = `display:inline-block;vertical-align:baseline;width:${a.width}px;height:${a.height}px;line-height:0`;
  const svg = document.createElementNS(ns, "svg"),
    path = document.createElementNS(ns, "path");
  svg.setAttribute("viewBox", `0 0 ${a.width} ${a.height}`);
  svg.setAttribute("width", String(a.width));
  svg.setAttribute("height", String(a.height));
  svg.style.cssText = "display:block;pointer-events:none;overflow:visible";
  path.setAttribute("d", shapePath(a));
  path.setAttribute("fill", a.kind === "line" ? "none" : a.fill);
  path.setAttribute("stroke", a.stroke);
  path.setAttribute("stroke-width", String(a.strokeWidth));
  path.setAttribute("stroke-linejoin", "miter");
  path.setAttribute("stroke-linecap", "butt");
  svg.append(path);
  dom.append(svg);
  return dom;
}
export const shapeSpec: NodeSpec = {
  inline: true,
  group: "inline",
  atom: true,
  draggable: true,
  marks: "",
  attrs: Object.fromEntries(
    Object.entries({ ...shapeDefaults, blockId: null }).map(([key, value]) => [
      key,
      { default: value },
    ]),
  ),
  parseDOM: [
    {
      tag: "span[data-document-shape]",
      priority: 90,
      getAttrs: (dom) =>
        shapeProperties(JSON.parse(dom.getAttribute("data-document-shape")!)),
    },
  ],
  toDOM: (node) => shapeDOM(node.attrs),
};
export function putShape(attrs: Record<string, unknown>, id?: string): Command {
  return (state, dispatch) => {
    const values = shapeProperties(attrs),
      tr = closeHistory(state.tr);
    let pos = -1;
    if (id)
      state.doc.descendants((node, at) => {
        if (node.type.name === "shape" && node.attrs.blockId === id) pos = at;
      });
    if (id && pos < 0) return false;
    const node = state.schema.nodes.shape.create({
      ...values,
      blockId: id || `shape_${crypto.randomUUID()}`,
    });
    if (id) tr.replaceWith(pos, pos + state.doc.nodeAt(pos)!.nodeSize, node);
    else tr.replaceSelectionWith(node, false);
    tr.doc.descendants((n, at) => {
      if (n.type.name === "shape" && n.attrs.blockId === node.attrs.blockId)
        pos = at;
    });
    tr.setSelection(NodeSelection.create(tr.doc, pos));
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}
