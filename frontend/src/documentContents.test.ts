import { it, expect } from "vitest";
import { EditorState, NodeSelection } from "prosemirror-state";
import { history, undo, redo, closeHistory } from "prosemirror-history";
import { schema, parseEditorDocument } from "./Editor";
import { identifiedDocument, blockIdentities } from "./blockIdentities";
import {
  referenceIndex,
  projectContentsIndex,
  referenceRefreshTransaction,
} from "./documentReferences";
import {
  refreshedContents,
  insertContents,
  protectContents,
} from "./documentContents";
import { documentText } from "./textProjection";
import { documentUnits } from "./arrangementUnits";
import { speechText } from "./speechText";
import type { DocNode, Project } from "./types";
const heading = (id: string, level: number, text: string): DocNode => ({
  type: "heading",
  attrs: { blockId: id, level, headingNumbered: true },
  content: [{ type: "text", text }],
});
const source: DocNode = {
  type: "doc",
  content: [
    heading("a", 1, "First"),
    heading("b", 2, "Child"),
    heading("c", 3, "Deeper"),
  ],
};
const contents = (): DocNode =>
  refreshedContents(
    {
      type: "table_of_contents",
      attrs: {
        blockId: "contents",
        title: "Contents",
        depth: 2,
        entryStyle: null,
        pageNumbers: false,
      },
    },
    referenceIndex([{ document: source }]),
  );
it("lists captions by kind, retains page values and follows changed caption order", () => {
  const captions: DocNode[] = ["Figure", "Table", "Figure"].map((label, i) => ({
    type: "paragraph",
    attrs: { blockId: `caption-${i}`, captionLabel: label },
    content: [
      { type: "text", text: label + " " },
      {
        type: "sequence",
        attrs: { sequenceName: label },
        content: [
          {
            type: "text",
            text: String(label === "Table" ? 1 : i === 0 ? 1 : 2),
          },
        ],
      },
      { type: "text", text: `: Caption ${i}` },
    ],
  }));
  const index = referenceIndex([
    { document: { type: "doc", content: [...source.content!, ...captions] } },
  ]);
  const figures = refreshedContents(
    {
      type: "table_of_contents",
      attrs: {
        title: "List of figures",
        kind: "figures",
        depth: 1,
        entryStyle: null,
        pageNumbers: true,
      },
    },
    index,
  );
  expect(documentText(figures)).toBe(
    "List of figures\nFigure 1: Caption 0\t—\nFigure 2: Caption 2\t—",
  );
  figures.content![2].content!.at(-1)!.content = [{ type: "text", text: "iv" }];
  const reordered = referenceIndex([
    {
      document: {
        type: "doc",
        content: [captions[2], captions[1], captions[0]],
      },
    },
  ]);
  const next = refreshedContents(figures, reordered);
  expect(documentText(next.content![1])).toBe("Figure 2: Caption 2\tiv");
  const tables = refreshedContents(
    {
      ...figures,
      attrs: {
        ...figures.attrs,
        kind: "tables",
        title: "List of tables",
        pageNumbers: false,
      },
    },
    index,
  );
  expect(documentText(tables)).toBe("List of tables\nTable 1: Caption 1");
  expect(
    parseEditorDocument({
      type: "doc",
      content: [figures, tables, ...captions],
    }).error,
  ).toBeNull();
  const current = projectContentsIndex({
    styles: [],
    book: {
      chapters: [
        {
          id: "included",
          document: {
            type: "doc",
            content: [captions[2], captions[1], captions[0]],
          },
        },
        {
          id: "excluded",
          include: false,
          document: { type: "doc", content: captions },
        },
      ],
    },
  } as unknown as Project);
  expect(current.resolve("caption-2")).toBe("Figure 1: Caption 2");
  expect(documentText(captions[2])).toBe("Figure 2: Caption 2");
});
it("generates only selected heading levels with stable numbered links and formatting", () => {
  const result = contents();
  expect(documentText(result)).toBe("Contents\n1 First\n1.1 Child");
  expect(
    parseEditorDocument({ type: "doc", content: [result] }).error,
  ).toBeNull();
  result.content![1].attrs!.color = "#112233";
  const moved = {
    ...source,
    content: [source.content![1], source.content![0]],
  };
  const next = refreshedContents(result, referenceIndex([{ document: moved }]));
  expect(documentText(next)).toBe("Contents\n1.1 Child\n1 First");
  expect(next.content![2].attrs?.color).toBe("#112233");
  const pm = schema.node("doc", null, [schema.nodeFromJSON(next)]);
  expect(documentUnits(pm)).toEqual([]);
  expect(speechText(pm).text.trim()).toBe("");
});
it("inserts and updates as one block, protects partial edits, and supports deletion undo", () => {
  let state = EditorState.create({
    schema,
    plugins: [history(), protectContents(), blockIdentities()],
  });
  state = state.applyTransaction(
    insertContents(state, contents()).setMeta("contentsUpdate", true),
  ).state;
  state = state.apply(closeHistory(state.tr));
  expect(state.doc.firstChild!.type.name).toBe("table_of_contents");
  const before = state.doc;
  state = state.applyTransaction(state.tr.insertText("wrong", 3)).state;
  expect(state.doc.eq(before)).toBe(true);
  state = state.apply(
    state.tr.setSelection(NodeSelection.create(state.doc, 0)),
  );
  state = state.applyTransaction(state.tr.deleteSelection()).state;
  expect(state.doc.firstChild!.type.name).toBe("paragraph");
  undo(state, (tr) => {
    state = state.applyTransaction(tr).state;
  });
  expect(state.doc.firstChild!.type.name).toBe("table_of_contents");
  redo(state, (tr) => {
    state = state.applyTransaction(tr).state;
  });
  expect(state.doc.firstChild!.type.name).toBe("paragraph");
});
it("maps a caret after a changed generated block through field refresh", () => {
  const before = identifiedDocument(
    schema.node("doc", null, [
      schema.nodeFromJSON(contents()),
      schema.node("paragraph", null, schema.text("After")),
    ]),
  );
  const state = EditorState.create({ doc: before });
  const updated = refreshedContents(
    before.toJSON(),
    referenceIndex([
      {
        document: {
          type: "doc",
          content: [...source.content!, heading("d", 1, "Last")],
        },
      },
    ]),
  );
  expect(
    referenceRefreshTransaction(state, schema.nodeFromJSON(updated)),
  ).toBeTruthy();
});
