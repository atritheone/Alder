import { expect, it } from "vitest";
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
import { history, undo, redo } from "prosemirror-history";
import { schema, parseEditorDocument } from "./Editor";
import {
  formFieldGuards,
  formFieldProperties,
  putFormField,
} from "./formFields";
import { projectText, documentText, projectedRange } from "./textProjection";
import { documentUnits, moveArrangementUnit } from "./arrangementUnits";
import { identifiedDocument, blockIdentities } from "./blockIdentities";
import { proofreadingTransaction } from "./proofreadingEdits";
import { replaceMatches } from "./findText";

const field = (attrs = {}, text = "Alpha. Beta.") =>
  schema.nodes.form_field.create(
    { blockId: "field", kind: "rich", ...attrs },
    text ? schema.text(text, [schema.marks.strong.create()]) : [],
  );
const doc = (node = field()) =>
  schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, [
      schema.text("Before "),
      node,
      schema.text(" After."),
    ]),
    schema.nodes.paragraph.create(null, schema.text("Destination.")),
  ]);

it("keeps field values in speech/correction offsets without prompts or boundaries", () => {
  const original = doc(),
    projection = projectText(original);
  expect(projection.text).toBe("Before Alpha. Beta. After.\nDestination.");
  expect(projection.text).toBe(documentText(original.toJSON()));
  for (const word of ["Before ", "Alpha. Beta.", "Beta.", " After."]) {
    const start = projection.text.indexOf(word),
      range = projectedRange(original, start, start + word.length);
    expect(original.textBetween(range.from, range.to)).toBe(word);
    let state = EditorState.create({
      doc: original,
      plugins: [formFieldGuards()],
    });
    state = state.applyTransaction(
      state.tr.insertText("Changed", range.from, range.to),
    ).state;
    let count = 0;
    state.doc.descendants((n) => {
      if (n.type.name === "form_field") count++;
    });
    expect(count).toBe(1);
  }
  expect(projectText(doc(field({}, ""))).text).not.toContain("Field");
});

it("preserves the whole field when moving a sentence and undoing", () => {
  const original = doc(field({ lockDelete: true, lockContent: true }));
  let state = EditorState.create({
    doc: original,
    plugins: [history(), formFieldGuards()],
  });
  const units = documentUnits(original),
    unit = units.find((u) => u.kind === "sentence")!;
  expect(unit.text).toBe("Before Alpha. Beta.");
  state = state.applyTransaction(
    moveArrangementUnit(state, unit, original.content.size - 1)!.tr,
  ).state;
  expect(state.doc.firstChild!.textContent).not.toContain("Alpha");
  expect(state.doc.lastChild!.textContent).toContain("Alpha. Beta.");
  undo(state, (tr) => {
    state = state.applyTransaction(tr).state;
  });
  expect(state.doc.eq(original)).toBe(true);
  redo(state, (tr) => {
    state = state.applyTransaction(tr).state;
  });
  expect(state.doc.lastChild!.textContent).toContain("Alpha. Beta.");
});

it("blocks locked corrections, formatting, raw unlock and deletion but allows surrounding edits", () => {
  const original = doc(field({ lockContent: true, lockDelete: true })),
    errors: string[] = [];
  const state = EditorState.create({
    doc: original,
    plugins: [formFieldGuards((m) => errors.push(m))],
  });
  const at = 8,
    n = original.nodeAt(at)!;
  for (const tr of [
    state.tr.insertText("x", at + 1, at + 2),
    state.tr.delete(at, at + n.nodeSize),
    state.tr.setNodeMarkup(at, undefined, { ...n.attrs, lockDelete: false }),
    state.tr.addMark(at + 1, at + 2, schema.marks.em.create()),
  ])
    expect(state.applyTransaction(tr).state.doc.eq(original)).toBe(true);
  expect(errors).toHaveLength(4);
  expect(
    state.applyTransaction(state.tr.insertText("x", 2)).state.doc.eq(original),
  ).toBe(false);
});

it("changes restrictions deliberately in properties, with atomic undo/redo", () => {
  const original = doc(field({ lockContent: true, lockDelete: true }));
  let state = EditorState.create({
    doc: original,
    plugins: [history(), formFieldGuards()],
  });
  putFormField(
    { kind: "date", dateValue: "2026-10-30", lockDelete: true },
    [],
    "field",
  )(state, (tr) => {
    state = state.applyTransaction(tr).state;
  });
  expect(state.selection).toBeInstanceOf(NodeSelection);
  expect((state.selection as NodeSelection).node.textContent).toBe(
    "2026-10-30",
  );
  undo(state, (tr) => {
    state = state.applyTransaction(tr).state;
  });
  expect(state.doc.eq(original)).toBe(true);
  redo(state, (tr) => {
    state = state.applyTransaction(tr).state;
  });
  expect(state.doc.textContent).toContain("2026-10-30");
});

it("keeps copied controls independent and retains restrictions", () => {
  const original = doc(field({ lockDelete: true }));
  const copied = identifiedDocument(
    schema.nodes.doc.create(null, original.content.append(original.content)),
  );
  const fields: any[] = [];
  copied.descendants((n) => {
    if (n.type.name === "form_field") fields.push(n);
  });
  expect(fields).toHaveLength(2);
  expect(fields[0].attrs.blockId).not.toBe(fields[1].attrs.blockId);
  expect(fields[1].attrs.lockDelete).toBe(true);
  expect(fields[1].textContent).toBe("Alpha. Beta.");
});

it("rejects invalid dates, nested content and inconsistent checkbox values before editing", () => {
  for (const value of ["2026-02-30", "0000-01-01", "2026-13-01", "20260101"])
    expect(() =>
      formFieldProperties({ kind: "date", dateValue: value }),
    ).toThrow();
  for (const node of [
    {
      type: "form_field",
      attrs: { kind: "checkbox", checked: true },
      content: [{ type: "text", text: "wrong" }],
    },
    {
      type: "form_field",
      attrs: { kind: "rich" },
      content: [{ type: "inline_image", attrs: { src: "x" } }],
    },
  ])
    expect(
      parseEditorDocument({
        type: "doc",
        content: [{ type: "paragraph", content: [node] }],
      }).document,
    ).toBeNull();
});

it("corrects and replaces editable values without removing the control, but refuses locked values", () => {
  for (const locked of [false, true]) {
    const original = doc(field({ lockContent: locked })),
      state = EditorState.create({
        doc: original,
        plugins: [formFieldGuards()],
      }),
      text = projectText(original).text;
    const start = text.indexOf("Beta"),
      end = start + 4;
    for (const command of [
      () =>
        proofreadingTransaction(state, text, [
          { start, end, originalText: "Beta", replacement: "Gamma" },
        ]),
      () => replaceMatches(state, [{ start, end }], "Gamma", text),
    ]) {
      if (locked) expect(command).toThrow(/locked/);
      else {
        const changed = state.applyTransaction(command()).state;
        expect(changed.doc.nodeAt(8)!.type.name).toBe("form_field");
        expect(changed.doc.nodeAt(8)!.textContent).toBe("Alpha. Gamma.");
      }
    }
  }
});

it("inserts, protects and moves a rich block as one unit with independent paragraph identities", () => {
  const original = schema.node("doc", null, [
    schema.node("paragraph", null, schema.text("Before")),
    schema.node("paragraph", null, schema.text("After")),
  ]);
  let state = EditorState.create({
    doc: identifiedDocument(original),
    selection: TextSelection.create(original, 7),
    plugins: [history(), blockIdentities(), formFieldGuards()],
  });
  const before = state.doc;
  putFormField(
    { kind: "rich", label: "Section", lockContent: true, lockDelete: true },
    [
      { type: "paragraph", content: [{ type: "text", text: "First" }] },
      { type: "paragraph", content: [{ type: "text", text: "Second" }] },
    ],
    undefined,
    true,
  )(state, (tr) => {
    state = state.applyTransaction(tr).state;
  });
  const field = (state.selection as NodeSelection).node;
  expect(field.type.name).toBe("form_block");
  expect(
    new Set([
      field.attrs.blockId,
      field.child(0).attrs.blockId,
      field.child(1).attrs.blockId,
    ]).size,
  ).toBe(3);
  expect(projectText(state.doc).text).toBe("Before\nFirst\nSecond\nAfter");
  const unit = documentUnits(state.doc).find((u) => u.text === "FirstSecond")!;
  expect(unit.kind).toBe("paragraph");
  const moved = moveArrangementUnit(state, unit, state.doc.content.size)!;
  state = state.applyTransaction(moved.tr).state;
  expect(state.doc.lastChild!.eq(field)).toBe(true);
  // The entire section is protected from an individual paragraph deletion.
  const pos = state.doc.content.size - field.nodeSize;
  const tr = state.tr.delete(pos + 1, pos + 1 + field.firstChild!.nodeSize);
  expect(state.applyTransaction(tr).state.doc.eq(state.doc)).toBe(true);
  undo(state, (t) => {
    state = state.applyTransaction(t).state;
  });
  undo(state, (t) => {
    state = state.applyTransaction(t).state;
  });
  expect(state.doc.eq(before)).toBe(true);
});
