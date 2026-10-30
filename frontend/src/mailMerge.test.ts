import { describe, it, expect } from "vitest";
import {
  mergeRecordSelection,
  mergePreview,
  mergeFieldKeys,
} from "./mailMerge";
import { schema } from "./Editor";
import { EditorState } from "prosemirror-state";
import {
  insertDocumentField,
  refreshedDocumentFields,
  documentFieldValues,
} from "./documentFields";

describe("mail merge", () => {
  it("selects exact, unique records and rejects malformed or excessive ranges", () => {
    expect(mergeRecordSelection("3, 1-3, 8", 10)).toEqual([1, 2, 3, 8]);
    expect(mergeRecordSelection("", 10)).toEqual([]);
    for (const value of ["0", "3-1", "102", "1-101", "a", "1,"])
      expect(() => mergeRecordSelection(value, 101)).toThrow();
  });
  it("previews literal marked values and multiline or empty fields without altering the template", () => {
    const source = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hello " },
            {
              type: "document_field",
              attrs: { fieldKind: "merge", mergeKey: "Name" },
              marks: [{ type: "strong" }],
              content: [{ type: "text", text: "Name" }],
            },
          ],
        },
      ],
    };
    const original = structuredClone(source),
      preview = mergePreview(source, { Name: "A < B\r\n=2+3" });
    expect(source).toEqual(original);
    expect(preview.content![0].content!.slice(1)).toEqual([
      { type: "text", text: "A < B", marks: [{ type: "strong" }] },
      { type: "hard_break" },
      { type: "text", text: "=2+3", marks: [{ type: "strong" }] },
    ]);
    expect(mergePreview(source, { Name: "" }).content![0].content).toHaveLength(
      1,
    );
    expect(mergeFieldKeys(source)).toEqual(["Name"]);
  });
  it("inserts an atomic merge field and retains it when ordinary fields refresh", () => {
    const state = EditorState.create({ schema }),
      tr = insertDocumentField(state, "merge", "Name", "field-id", "Name");
    const node = tr.doc.firstChild!.firstChild!;
    expect(node.isAtom).toBe(true);
    expect(node.attrs.mergeKey).toBe("Name");
    const values = documentFieldValues({ name: "Letter", settings: {} } as any);
    expect(refreshedDocumentFields(tr.doc.toJSON(), values)).toEqual(
      tr.doc.toJSON(),
    );
    expect(() =>
      insertDocumentField(state, "merge", "No", "field-id", 'bad"key'),
    ).toThrow();
  });
});
