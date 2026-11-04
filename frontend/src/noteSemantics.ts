import type { DocNode } from "./types";

export type NoteSemanticPart = {
  key: string;
  role: string;
  order: number;
  colSpan?: number;
  rowSpan?: number;
  column?: number;
  row?: number;
  columns?: number;
  rows?: number;
};
export type NoteSemanticPath = NoteSemanticPart[];

/** Original node identities keep a continued cell/list item in one logical story. */
export function noteSemanticPaths(body: DocNode) {
  const paragraphs = new Map<string, NoteSemanticPath>();
  const pictures: NoteSemanticPath[] = [];
  const grid = new WeakMap<
    DocNode,
    { column?: number; row?: number; columns?: number; rows?: number }
  >();
  const roles: Record<string, string> = {
    paragraph: "paragraph",
    table: "table",
    table_row: "row",
    table_cell: "cell",
    table_header: "columnheader",
    bullet_list: "list",
    ordered_list: "list",
    list_item: "listitem",
  };
  function walk(
    node: DocNode,
    path: NoteSemanticPath,
    address: string,
    order: number,
  ) {
    if (node.type === "table") {
      const occupied: number[] = [];
      let columns = 0;
      node.content?.forEach((row, r) => {
        grid.set(row, { row: r + 1 });
        let column = 0;
        row.content?.forEach((cell) => {
          while ((occupied[column] || 0) > r) column++;
          const span = Number(cell.attrs?.colspan || 1),
            height = Number(cell.attrs?.rowspan || 1);
          grid.set(cell, { column: column + 1, row: r + 1 });
          for (let c = column; c < column + span; c++) occupied[c] = r + height;
          column += span;
          columns = Math.max(columns, column);
        });
      });
      grid.set(node, { columns, rows: node.content?.length || 0 });
    }
    const role =
      roles[node.type] ||
      (["image", "inline_image"].includes(node.type) &&
      path.at(-1)?.role !== "paragraph"
        ? "presentation"
        : undefined);
    const current = role
      ? [
          ...path,
          {
            key: String(node.attrs?.blockId || address),
            role,
            order,
            ...grid.get(node),
            ...(["table_cell", "table_header"].includes(node.type)
              ? {
                  colSpan: Number(node.attrs?.colspan || 1),
                  rowSpan: Number(node.attrs?.rowspan || 1),
                }
              : {}),
          },
        ]
      : path;
    if (node.type === "paragraph")
      paragraphs.set(String(node.attrs?.blockId), current);
    if (["image", "inline_image"].includes(node.type)) pictures.push(current);
    node.content?.forEach((child, i) =>
      walk(child, current, `${address}.${i}`, i),
    );
  }
  walk(body, [], "note", 0);
  return { paragraphs, pictures };
}

/** Rich note paint is measured as independent bands. Reassemble its logical
 * hierarchy only in the isolated publication window, retaining every ink box.
 * All geometry is read before moving any node, avoiding layout feedback. */
export function prepareNotePublicationSemantics() {
  type Ink = {
    element: HTMLElement;
    content: HTMLElement;
    path: NoteSemanticPath;
    top: number;
    left: number;
    width: number;
    order: number[];
    repeated: Element | null;
  };
  const stories: {
    sheet: HTMLElement;
    id: string;
    fragments: HTMLElement[];
    inks: Ink[];
  }[] = [];
  for (const sheet of document.querySelectorAll<HTMLElement>(
    ".publication-sheet",
  )) {
    const origin = sheet.getBoundingClientRect();
    const byId = new Map<string, HTMLElement[]>();
    for (const fragment of sheet.querySelectorAll<HTMLElement>(
      "[data-note-fragment]",
    )) {
      const id = fragment.dataset.noteFragment!;
      const fragments = byId.get(id) || [];
      fragments.push(fragment);
      byId.set(id, fragments);
    }
    for (const [id, fragments] of byId) {
      const inks: Ink[] = [];
      for (const fragment of fragments)
        for (const element of fragment.querySelectorAll<HTMLElement>(
          "[data-note-structure]",
        )) {
          const repeated =
            element.closest("[data-note-repeated-header]") ||
            (element.dataset.noteRepeatedInk ? fragment : null);
          if (element.closest('[aria-hidden="true"]') && !repeated) continue;
          if (element.dataset.imageDecorative === "true") continue;
          const box = element.getBoundingClientRect();
          if (!box.width || !box.height) continue;
          inks.push({
            element,
            content:
              element.parentElement?.tagName === "A"
                ? element.parentElement
                : element,
            path: JSON.parse(element.dataset.noteStructure!),
            repeated,
            top: box.top - origin.top,
            left: box.left - origin.left,
            width: box.width,
            order: JSON.parse(element.dataset.noteOrder || "[0,0]"),
          });
        }
      const authored = new Set(
        inks
          .filter((ink) => !ink.repeated)
          .map((ink) => JSON.stringify(ink.path.map((part) => part.key))),
      );
      const repeats = new Map<string, Element>();
      const unique = inks.filter((ink) => {
        if (!ink.repeated) return true;
        const key = JSON.stringify(ink.path.map((part) => part.key));
        if (authored.has(key)) return false;
        if (!repeats.has(key)) repeats.set(key, ink.repeated);
        return repeats.get(key) === ink.repeated;
      });
      if (unique.length) stories.push({ sheet, id, fragments, inks: unique });
    }
  }
  for (const { sheet, id, fragments, inks } of stories) {
    const story = document.createElement("div");
    story.setAttribute("role", "note");
    story.dataset.publishedNote = id;
    story.style.cssText = "position:absolute;inset:0;pointer-events:none";
    for (const fragment of fragments) {
      fragment.setAttribute("role", "presentation");
      // Keep the original destination at the note's measured page position.
      // The semantic wrapper spans the sheet and is not a navigation target.
    }
    type Group = {
      element: HTMLElement;
      order: number;
      children: Map<string, Group>;
      inks: Ink[];
    };
    const root: Group = {
      element: story,
      order: 0,
      children: new Map(),
      inks: [],
    };
    for (const ink of inks) {
      let parent = root;
      for (const part of ink.path) {
        let group = parent.children.get(part.key);
        if (!group) {
          const tags:Record<string,string>={table:"table",row:"tr",cell:"td",columnheader:"th",paragraph:"p",list:"ul",listitem:"li"};
          const element = document.createElement(tags[part.role]||"div");
          element.setAttribute("role", part.role);
          if(part.role==="columnheader")element.setAttribute("scope","col");
          if(part.colSpan)element.setAttribute("colspan",String(part.colSpan));
          if(part.rowSpan)element.setAttribute("rowspan",String(part.rowSpan));
          element.style.display = "contents";
          // Chromium's PDF writer reads native table layout spans, not ARIA's
          // parallel span attributes. Tiny transparent cells establish that
          // grid; all authored paint remains absolutely positioned on the page.
          if(part.role==="table")element.style.cssText="display:table;position:static;border-collapse:collapse;border:0;margin:0;padding:0";
          if(part.role==="row")element.style.display="table-row";
          if(part.role==="cell"||part.role==="columnheader")element.style.cssText="display:table-cell;position:static;width:1px;height:1px;padding:0;border:0";
          for (const [key, value] of Object.entries({
            "aria-colindex": part.column,
            "aria-rowindex": part.row,
            "aria-colcount": part.columns,
            "aria-rowcount": part.rows,
          }))
            if (value) element.setAttribute(key, String(value));
          if (part.colSpan && part.colSpan > 1)
            element.setAttribute("aria-colspan", String(part.colSpan));
          if (part.rowSpan && part.rowSpan > 1)
            element.setAttribute("aria-rowspan", String(part.rowSpan));
          group = { element, order: part.order, children: new Map(), inks: [] };
          parent.children.set(part.key, group);
        }
        parent = group;
      }
      parent.inks.push(ink);
    }
    const compare = (a: Ink, b: Ink) => {
      for (let i = 0; i < Math.max(a.order.length, b.order.length); i++) {
        const delta = (a.order[i] || 0) - (b.order[i] || 0);
        if (delta) return delta;
      }
      return 0;
    };
    const paint = (group: Group) => {
      for (const child of [...group.children.values()].sort(
        (a, b) => a.order - b.order,
      )) {
        group.element.append(child.element);
        paint(child);
      }
      for (const ink of group.inks.sort(compare)) {
        if (ink.repeated) ink.element.removeAttribute("aria-hidden");
        ink.element.style.position = "absolute";
        ink.element.style.left = `${ink.left}px`;
        ink.element.style.top = `${ink.top}px`;
        ink.element.style.width = `${ink.width}px`;
        group.element.append(ink.content);
      }
    };
    paint(root);
    sheet.append(story);
  }
}
