import { it, expect } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { schema } from "./Editor";
import {
  documentFieldValues,
  refreshedDocumentFields,
  insertDocumentField,
} from "./documentFields";
import {
  referenceRefreshTransaction,
  updateProjectReferences,
} from "./documentReferences";
import { documentText } from "./textProjection";
import { changeCase } from "./caseTransform";
import { replaceMatches } from "./findText";
import type { Project } from "./types";

const project = () =>
  ({
    name: "Document title",
    settings: { author: "A. Writer", subject: "Subject" },
    clips: [],
    book: { chapters: [] },
  }) as unknown as Project;
it("inserts a field with ordinary undo while protecting generated values from replacements", () => {
  let state = EditorState.create({ schema, plugins: [history()] });
  const before = state.doc;
  state = state.apply(insertDocumentField(state, "author", "A. Writer"));
  expect(state.doc.firstChild?.firstChild?.attrs.fieldKind).toBe("author");
  expect(changeCase(state, "upper", true).doc.textContent).toBe("A. Writer");
  expect(() =>
    replaceMatches(state, [{ start: 3, end: 9 }], "Other", "A. Writer"),
  ).toThrow();
  undo(state, (tr) => {
    state = state.apply(tr);
  });
  expect(state.doc.eq(before)).toBe(true);
});
it("refreshes explicit fields, preserves unchanged nodes, and maps a caret after them", () => {
  const p = project(),
    values = documentFieldValues(p, new Date(2020, 1, 29, 12));
  expect(values.date).toBe("2020-02-29");
  const doc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "document_field",
            attrs: { blockId: "field", fieldKind: "title" },
            content: [{ type: "text", text: "Old" }],
          },
          { type: "text", text: " body" },
        ],
      },
    ],
  };
  const updated = refreshedDocumentFields(doc, values);
  expect(documentText(updated)).toBe("Document title body");
  expect(refreshedDocumentFields(updated, values)).toBe(updated);
  const old = schema.nodeFromJSON(doc);
  let state = EditorState.create({
    doc: old,
    selection: TextSelection.atEnd(old),
  });
  const tr = referenceRefreshTransaction(state, schema.nodeFromJSON(updated))!;
  state = state.apply(tr);
  expect(state.selection.from).toBe(state.doc.content.size - 1);
  expect(
    documentText(refreshedDocumentFields(doc, { ...values, title: "" })),
  ).toBe("[Document title not set] body");
});
it("updates document properties before resolving references containing them", () => {
  const p = project();
  p.book!.chapters = [
    {
      id: "c",
      title: "Chapter",
      role: "chapter",
      voiceId: "default",
      include: true,
      text: "",
      document: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { blockId: "target", level: 1 },
            content: [
              {
                type: "document_field",
                attrs: { fieldKind: "title" },
                content: [{ type: "text", text: "Old" }],
              },
            ],
          },
          {
            type: "paragraph",
            content: [
              {
                type: "cross_reference",
                attrs: { targetId: "target" },
                content: [{ type: "text", text: "Old reference" }],
              },
            ],
          },
        ],
      },
    },
  ];
  updateProjectReferences(p);
  expect(p.book!.chapters[0].text).toBe("Document title\nDocument title");
});
it("retains page values during metadata refresh until physical layout resolves them", () => {
  const doc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "document_field",
            attrs: { fieldKind: "page" },
            content: [{ type: "text", text: "iv" }],
          },
          {
            type: "document_field",
            attrs: { fieldKind: "pageCount" },
            content: [{ type: "text", text: "20" }],
          },
        ],
      },
    ],
  };
  expect(refreshedDocumentFields(doc, documentFieldValues(project()))).toBe(
    doc,
  );
});
