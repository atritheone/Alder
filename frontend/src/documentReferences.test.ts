import { describe, it, expect } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { schema, parseEditorDocument } from "./Editor";
import { identifiedDocument } from "./blockIdentities";
import {
  referenceIndex,
  refreshedReferences,
  insertReference,
  referenceRefreshTransaction,
  projectReferenceIndex,
} from "./documentReferences";
import { projectText } from "./textProjection";
import { speechText } from "./speechText";
import { replaceMatches } from "./findText";
import { proofreadingTransaction } from "./proofreadingEdits";
import type { DocNode, Project } from "./types";
import { documentUnits, moveArrangementUnit } from "./arrangementUnits";
import { changeCase, caseInputPlugin } from "./caseTransform";

const field = (targetId: string, text = "Old wording"): DocNode => ({
  type: "cross_reference",
  attrs: { targetId, blockId: "field-" + targetId },
  content: [{ type: "text", text }],
});
const document = (): DocNode => ({
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1, blockId: "heading" },
      content: [{ type: "text", text: "New heading" }],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "bookmark",
          attrs: { name: "Passage", blockId: "passage", range: true },
        },
        { type: "text", text: "A passage" },
        {
          type: "bookmark_end",
          attrs: { targetId: "passage", name: "Passage" },
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "See " },
        field("heading"),
        { type: "text", text: " and " },
        field("passage"),
        { type: "text", text: "." },
      ],
    },
  ],
});
it("resolves heading numbers across included chapters, restarts and inherited styles", () => {
  const first = document(),
    second = document();
  first.content![0].attrs = {
    level: 1,
    blockId: "first",
    headingNumbered: true,
    headingStart: 5,
  };
  second.content![0].attrs = {
    level: 2,
    blockId: "second",
    styleId: "numbered",
  };
  const project = {
    styles: [
      {
        id: "numbered",
        name: "Numbered",
        kind: "paragraph",
        headingNumbered: true,
      },
    ],
    book: {
      chapters: [
        { id: "a", document: first },
        { id: "excluded", include: false, document: document() },
        { id: "b", document: second },
      ],
    },
  } as unknown as Project;
  expect(projectReferenceIndex(project).resolve("second", "number")).toBe(
    "5.1",
  );
  expect(projectReferenceIndex(project).resolve("heading")).toBeNull();
  project.book!.chapters.reverse();
  expect(projectReferenceIndex(project).resolve("second", "number")).toBe(
    "1.1",
  );
  second.content![0].attrs!.headingNumbered = false;
  expect(projectReferenceIndex(project).resolve("second", "number")).toBeNull();
  expect(projectReferenceIndex(project).resolve("second")).toBe("New heading");
});
it("resolves headings and passages; explicit updates preserve originals and missing targets", () => {
  const doc = document(),
    before = structuredClone(doc),
    index = referenceIndex([{ document: doc }]);
  expect(index.resolve("heading")).toBe("New heading");
  expect(index.resolve("passage")).toBe("A passage");
  const updated = refreshedReferences(doc, index);
  expect(doc).toEqual(before);
  expect(updated).not.toBe(doc);
  expect(refreshedReferences(updated, index)).toBe(updated);
  expect(parseEditorDocument(updated).error).toBeNull();
  const missing = refreshedReferences(doc, referenceIndex([]));
  expect(missing.content![2].content![1].attrs?.unresolved).toBe(true);
  expect(missing.content![2].content![1].content![0].text).toBe("Old wording");
});
it("rejects cyclic, duplicate, empty and incomplete targets without recursive expansion", () => {
  const doc = document();
  doc.content![0].content = [field("heading")];
  expect(referenceIndex([{ document: doc }]).resolve("heading")).toBeNull();
  expect(
    referenceIndex([
      { document: document() },
      { document: document() },
    ]).resolve("heading"),
  ).toBeNull();
  doc.content![1].content!.pop();
  expect(referenceIndex([{ document: doc }]).resolve("passage")).toBeNull();
});
it("inserts an atomic reference with undo, stable projection and reference-reading policy", () => {
  let state = EditorState.create({
    doc: identifiedDocument(schema.nodeFromJSON(document())),
    plugins: [history()],
  });
  state = state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc)));
  state = state.apply(insertReference(state, "heading", "Heading wording"));
  expect(projectText(state.doc).text.endsWith("Heading wording")).toBe(true);
  expect(speechText(state.doc, 0, undefined, false).text).not.toContain(
    "Heading wording",
  );
  expect(speechText(state.doc, 0, undefined, true).text).toContain(
    "Heading wording",
  );
  undo(state, (tr) => {
    state = state.apply(tr);
  });
  expect(projectText(state.doc).text).not.toContain("Heading wording");
});
it("maps the caret through field refreshes and rejects ordinary source replacements", () => {
  const doc = schema.nodeFromJSON(document());
  let state = EditorState.create({ doc });
  state = state.apply(state.tr.setSelection(TextSelection.atEnd(doc)));
  const next = schema.nodeFromJSON(
    refreshedReferences(document(), referenceIndex([{ document: document() }])),
  );
  const tr = referenceRefreshTransaction(state, next)!;
  expect(tr).toBeTruthy();
  expect(state.apply(tr).selection.eq(TextSelection.atEnd(next))).toBe(true);
  expect(tr.getMeta("addToHistory")).toBe(false);
  const changed = document();
  changed.content![0].content![0].text = "Changed authored text";
  expect(
    referenceRefreshTransaction(state, schema.nodeFromJSON(changed)),
  ).toBeNull();
});
it("protects generated wording from find and proofreading replacements", () => {
  const state = EditorState.create({ doc: schema.nodeFromJSON(document()) }),
    text = projectText(state.doc).text;
  const start = text.indexOf("Old wording"),
    end = start + 3;
  expect(() => replaceMatches(state, [{ start, end }], "New", text)).toThrow(
    /object|image|bookmark/,
  );
  expect(() =>
    proofreadingTransaction(state, text, [
      { start, end, originalText: "Old", replacement: "New" },
    ]),
  ).toThrow(/object/);
});
it("moves a multi-sentence reference as one atomic Arrangement unit", () => {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [
      schema.text("Before. "),
      schema.nodeFromJSON(field("heading", "First. Second.")),
      schema.text(" After."),
    ]),
    schema.node("paragraph", null, schema.text("Destination.")),
  ]);
  const units = documentUnits(doc).filter((unit) => unit.kind === "sentence");
  expect(units.map((unit) => unit.text)).toEqual([
    "Before.",
    "First. Second.",
    "After.",
    "Destination.",
  ]);
  const result = moveArrangementUnit(
    EditorState.create({ doc }),
    units[1],
    doc.content.size - 1,
  )!;
  let count = 0;
  result.tr.doc.descendants((node) => {
    if (node.type.name === "cross_reference") count++;
  });
  expect(count).toBe(1);
  expect(projectText(result.tr.doc).text).toContain("First. Second.");
});
it("case changes and typed-case preferences leave generated wording alone", () => {
  let state = EditorState.create({
    doc: schema.nodeFromJSON(document()),
    plugins: [caseInputPlugin(() => "upper")],
  });
  state = state.applyTransaction(changeCase(state, "upper", true)).state;
  expect(projectText(state.doc).text).toContain(
    "SEE Old wording AND Old wording",
  );
  state = state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc)));
  state = state.applyTransaction(
    insertReference(state, "heading", "Keep this case"),
  ).state;
  expect(projectText(state.doc).text).toContain("Keep this case");
});
