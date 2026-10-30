import type { Node as PMNode, NodeSpec } from "prosemirror-model";
import { NodeSelection, Plugin, type Command } from "prosemirror-state";
import { closeHistory, isHistoryTransaction } from "prosemirror-history";
import type { DocNode } from "./types";
import { validNoteBody } from "./documentNotes";
import { identifiedDocument } from "./blockIdentities";

export const formFieldDefaults = {
  kind: "plain",
  label: "",
  tag: "",
  lockContent: false,
  lockDelete: false,
  checked: false,
  dateValue: "",
};
export function formFieldProperties(value: Record<string, any>) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid form field properties.");
  const a = { ...formFieldDefaults, ...value };
  if (!["plain", "rich", "checkbox", "date"].includes(a.kind))
    throw new Error("Choose a supported form field type.");
  for (const key of ["label", "tag"] as const)
    if (
      typeof a[key] !== "string" ||
      a[key].length > 200 ||
      /[\x00-\x1f]/.test(a[key])
    )
      throw new Error(
        "Field names and tags must contain at most 200 printable characters.",
      );
  for (const key of ["lockContent", "lockDelete", "checked"] as const)
    if (typeof a[key] !== "boolean")
      throw new Error("Invalid form field setting.");
  if (
    typeof a.dateValue !== "string" ||
    (a.dateValue !== "" &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(a.dateValue) ||
        a.dateValue < "0001-01-01" ||
        Number.isNaN(Date.parse(a.dateValue)) ||
        new Date(a.dateValue).toISOString().slice(0, 10) !== a.dateValue))
  )
    throw new Error("Choose a valid calendar date.");
  return a;
}
export function fieldValue(
  a: ReturnType<typeof formFieldProperties>,
  content: DocNode[] = [],
) {
  const value =
    a.kind === "checkbox" ? (a.checked ? "\u2612" : "\u2610") : a.dateValue;
  return ["checkbox", "date"].includes(a.kind)
    ? value
      ? [{ type: "text", text: value }]
      : []
    : content;
}
export function validateFormField(node: DocNode) {
  const a = formFieldProperties(node.attrs || {}),
    content = node.content || [];
  if (node.type === "form_block") {
    if (
      a.kind !== "rich" ||
      node.marks?.length ||
      !validNoteBody({ type: "doc", content })
    )
      throw new Error(
        "A rich text block contains formatted paragraphs, lists, tables and inline or standalone images.",
      );
    return a;
  }
  const marks = [
    "strong",
    "em",
    "underline",
    "strike",
    "subscript",
    "superscript",
    "text_style",
    "link",
  ];
  if (
    content.some(
      (n) =>
        !["text", "hard_break"].includes(n.type) ||
        n.content ||
        n.marks?.some((m) => a.kind !== "rich" || !marks.includes(m.type)),
    )
  )
    throw new Error(
      "Use text and line breaks in a form field; rich text can also contain formatting and links.",
    );
  if (
    ["checkbox", "date"].includes(a.kind) &&
    JSON.stringify(content) !== JSON.stringify(fieldValue(a))
  )
    throw new Error(
      "The field value does not match its checkbox or date setting.",
    );
  if (node.marks?.some((m) => m.type.startsWith("revision_")))
    throw new Error("Form fields do not support tracked changes yet.");
  return a;
}
export const formFieldSpec: NodeSpec = {
  inline: true,
  group: "inline",
  content: "(text|hard_break)*",
  atom: true,
  draggable: true,
  marks: "_",
  attrs: Object.fromEntries(
    Object.entries({ ...formFieldDefaults, blockId: null }).map(([k, v]) => [
      k,
      { default: v },
    ]),
  ),
  parseDOM: [
    {
      tag: "span[data-form-field]",
      priority: 100,
      getAttrs: (el) => {
        try {
          return formFieldProperties(
            JSON.parse(el.getAttribute("data-form-field")!),
          );
        } catch {
          return false;
        }
      },
    },
  ],
  toDOM: (n) => [
    "span",
    {
      "data-form-field": JSON.stringify(n.attrs),
      "data-field-id": n.attrs.blockId,
      "data-field-kind": n.attrs.kind,
      "data-empty-field": n.content.size ? null : "true",
      "data-placeholder": n.attrs.label || "Field",
      title: `${n.attrs.label || "Form field"}: double-click or press Enter to edit${n.attrs.kind === "checkbox" ? "; Space to toggle" : ""}`,
      class: "form-field",
      contenteditable: "false",
      role: "group",
      "aria-label": `${n.attrs.label || "Form field"}${n.attrs.lockContent ? ", content locked" : ""}`,
    },
    0,
  ],
};

export const formBlockSpec: NodeSpec = {
  group: "block",
  content: "block+",
  atom: true,
  isolating: true,
  draggable: true,
  attrs: formFieldSpec.attrs,
  parseDOM: [
    {
      tag: "div[data-form-field]",
      priority: 100,
      getAttrs: (el) => {
        try {
          return formFieldProperties(
            JSON.parse(el.getAttribute("data-form-field")!),
          );
        } catch {
          return false;
        }
      },
    },
  ],
  toDOM: (n) => [
    "div",
    {
      "data-form-field": JSON.stringify(n.attrs),
      "data-field-id": n.attrs.blockId,
      "data-field-kind": "richBlock",
      class: "form-field form-block",
      contenteditable: "false",
      role: "group",
      "aria-label": n.attrs.label || "Rich text field",
      title: `${n.attrs.label || "Rich text field"}: double-click or press Enter to edit`,
    },
    0,
  ],
};

export function putFormField(
  attrs: Record<string, any>,
  content: DocNode[],
  id?: string,
  block = false,
): Command {
  return (state, dispatch) => {
    const values = formFieldProperties(attrs),
      value = fieldValue(values, content);
    const type = block ? "form_block" : "form_field";
    validateFormField({ type, attrs: values, content: value });
    let pos = -1;
    if (id)
      state.doc.descendants((n, at) => {
        if (
          ["form_field", "form_block"].includes(n.type.name) &&
          n.attrs.blockId === id
        )
          pos = at;
      });
    if (id && pos < 0) return false;
    if (id && state.doc.nodeAt(pos)!.type.name !== type) return false;
    const node = identifiedDocument(
      state.schema.nodes[type].create(
        { ...values, blockId: id || `field_${crypto.randomUUID()}` },
        value.map((n) => state.schema.nodeFromJSON(n)),
      ),
    );
    const tr = closeHistory(state.tr).setMeta(
      "formFieldProperties",
      node.attrs.blockId,
    );
    if (id) tr.replaceWith(pos, pos + state.doc.nodeAt(pos)!.nodeSize, node);
    else {
      tr.replaceSelectionWith(node);
      tr.doc.descendants((n, at) => {
        if (n.attrs.blockId === node.attrs.blockId) pos = at;
      });
    }
    if (pos < 0) return false;
    tr.setSelection(NodeSelection.create(tr.doc, pos));
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

export function formFieldTextEdit(
  node: PMNode,
  from: number,
  to: number,
  pos: number,
) {
  if (!["form_field", "form_block"].includes(node.type.name)) return false;
  if (from <= pos || to >= pos + node.nodeSize)
    throw new Error(
      "This edit crosses a form field. Edit its value separately to retain the field.",
    );
  if (node.attrs.lockContent)
    throw new Error(
      "This field is locked. Change its restrictions in Form field properties.",
    );
  if (!["plain", "rich"].includes(node.attrs.kind))
    throw new Error(
      "Change checkbox and date values in Form field properties.",
    );
  return true;
}

/** Cache unchanged subtrees, so ordinary typing does not inspect every character. */
export function formFieldGuards(onError: (message: string) => void = () => {}) {
  const cache = new WeakMap<PMNode, PMNode[]>();
  const fields = (node: PMNode): PMNode[] => {
    let result = cache.get(node);
    if (!result) {
      const field = ["form_field", "form_block"].includes(node.type.name);
      result = field ? [node] : [];
      if (!field)
        node.forEach((n) => {
          result!.push(...fields(n));
        });
      cache.set(node, result);
    }
    return result;
  };
  return new Plugin({
    filterTransaction(tr, state) {
      if (!tr.docChanged) return true;
      try {
        const next = fields(tr.doc),
          previous = fields(state.doc),
          unchanged = new Set(previous),
          byId = new Map(next.map((n) => [n.attrs.blockId, n]));
        for (const n of next)
          if (!unchanged.has(n)) validateFormField(n.toJSON());
        if (isHistoryTransaction(tr) || tr.getMeta("blockIdentities"))
          return true;
        for (const before of previous) {
          const after = byId.get(before.attrs.blockId);
          if (tr.getMeta("formFieldProperties") === before.attrs.blockId)
            continue;
          if (
            (!after && before.attrs.lockDelete) ||
            (after &&
              (before.attrs.lockContent !== after.attrs.lockContent ||
                before.attrs.lockDelete !== after.attrs.lockDelete ||
                (before.attrs.lockContent && !before.eq(after))))
          )
            throw new Error(
              `“${before.attrs.label || "Form field"}” is locked. Change its restrictions in Form field properties.`,
            );
        }
        return true;
      } catch (e) {
        onError((e as Error).message);
        return false;
      }
    },
  });
}

/** Remove editing prompts without changing the measured line footprint. */
export function freezeFormFields(
  source: Element,
  target: Element,
  scale: number,
) {
  const originals = [
    ...(source.matches("[data-form-field]") ? [source as HTMLElement] : []),
    ...source.querySelectorAll<HTMLElement>("[data-form-field]"),
  ];
  [
    ...(target.matches("[data-form-field]") ? [target as HTMLElement] : []),
    ...target.querySelectorAll<HTMLElement>("[data-form-field]"),
  ].forEach((copy, i) => {
    const original = originals[i];
    copy.style.outline = "none";
    if (original.hasAttribute("data-empty-field")) {
      const rect = original.getBoundingClientRect();
      copy.style.display = "inline-block";
      copy.style.width = `${rect.width / scale}px`;
      copy.style.height = `${rect.height / scale}px`;
      copy.removeAttribute("data-empty-field");
    }
  });
}
