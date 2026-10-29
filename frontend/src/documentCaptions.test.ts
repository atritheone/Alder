import { it, expect } from "vitest";
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { schema } from "./Editor";
import { identifiedDocument } from "./blockIdentities";
import {
  captionObject,
  addCaption,
  numberedDocument,
  splitCaption,
} from "./documentCaptions";
import { referenceIndex, refreshedReferences } from "./documentReferences";
import { documentText } from "./textProjection";
import { copiedBookmarkTargets } from "./documentBookmarks";

it("adds a caption outside an inline image paragraph, retains its anchor and undoes together", () => {
  const doc = identifiedDocument(
    schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("Before "),
        schema.node("inline_image", {
          blockId: "picture",
          src: "/api/projects/p/assets/a",
          assetId: "a",
        }),
        schema.text(" after."),
      ]),
    ]),
  );
  let state = EditorState.create({
    doc,
    selection: NodeSelection.create(doc, 8),
    plugins: [history()],
  });
  expect(captionObject(state)?.id).toBe("picture");
  const dispatch = (tr: any) => {
    state = state.apply(tr);
  };
  expect(
    addCaption("picture", "Figure", "A picture", "after")(state, dispatch),
  ).toBe(true);
  expect(state.doc.childCount).toBe(2);
  expect(state.doc.child(1).attrs.captionTargetId).toBe("picture");
  expect(state.doc.child(1).textContent).toBe("Figure 1: A picture");
  expect(state.selection.$from.parent).toBe(state.doc.child(1));
  expect(addCaption("picture", "Figure", "Duplicate", "after")(state)).toBe(
    false,
  );
  undo(state, dispatch);
  expect(state.doc.eq(doc)).toBe(true);
});
it("inserts a table caption above the whole table from a cell selection", () => {
  const table = schema.node("table", { blockId: "table" }, [
    schema.node("table_row", null, [
      schema.node(
        "table_cell",
        null,
        schema.node("paragraph", null, schema.text("Cell")),
      ),
    ]),
  ]);
  const doc = identifiedDocument(schema.node("doc", null, [table]));
  let state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, 4),
  });
  expect(captionObject(state)?.id).toBe("table");
  expect(
    addCaption(
      "table",
      "Table",
      "Results",
      "before",
    )(state, (tr) => {
      state = state.apply(tr);
    }),
  ).toBe(true);
  expect(state.doc.firstChild?.textContent).toBe("Table 1: Results");
  expect(state.doc.firstChild?.attrs.keepWithNext).toBe(true);
  expect(state.doc.child(1).type.name).toBe("table");
});
it("renumbers separate figure/table sequences in document order before resolving references", () => {
  const doc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { captionLabel: "Figure", blockId: "first" },
        content: [
          { type: "text", text: "Figure " },
          {
            type: "sequence",
            attrs: { sequenceName: "Figure" },
            content: [{ type: "text", text: "9" }],
          },
          { type: "text", text: ": First" },
        ],
      },
      {
        type: "paragraph",
        attrs: { captionLabel: "Table", blockId: "second" },
        content: [
          { type: "text", text: "Table " },
          {
            type: "sequence",
            attrs: { sequenceName: "Table" },
            content: [{ type: "text", text: "9" }],
          },
        ],
      },
      {
        type: "paragraph",
        attrs: { captionLabel: "Figure", blockId: "third" },
        content: [
          { type: "text", text: "Figure " },
          {
            type: "sequence",
            attrs: { sequenceName: "Figure" },
            content: [{ type: "text", text: "9" }],
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "cross_reference",
            attrs: { targetId: "first" },
            content: [{ type: "text", text: "Old" }],
          },
        ],
      },
    ],
  };
  const numbered = numberedDocument(doc, { Figure: 0, Table: 0 });
  expect(documentText(numbered)).toBe(
    "Figure 1: First\nTable 1\nFigure 2\nOld",
  );
  const index = referenceIndex([{ document: numbered }]);
  expect(index.targets.get("first")?.kind).toBe("caption");
  expect(index.resolve("first", "labelNumber")).toBe("Figure 1");
  expect(index.resolve("first", "number")).toBe("1");
  expect(documentText(refreshedReferences(numbered, index))).toBe(
    "Figure 1: First\nTable 1\nFigure 2\nFigure 1: First",
  );
});
it("short references refresh independently of full caption wording and retain the chosen format", () => {
  const doc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { captionLabel: "Figure", blockId: "caption" },
        content: [
          { type: "text", text: "Figure " },
          {
            type: "sequence",
            attrs: { sequenceName: "Figure" },
            content: [{ type: "text", text: "7" }],
          },
          { type: "text", text: ": Changed title" },
        ],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "cross_reference",
            attrs: { targetId: "caption", referenceFormat: "labelNumber" },
            content: [{ type: "text", text: "Old" }],
          },
          { type: "text", text: " / " },
          {
            type: "cross_reference",
            attrs: { targetId: "caption", referenceFormat: "number" },
            content: [{ type: "text", text: "Old" }],
          },
        ],
      },
    ],
  };
  const updated = refreshedReferences(doc, referenceIndex([{ document: doc }]));
  expect(documentText(updated)).toBe("Figure 7: Changed title\nFigure 7 / 7");
  expect(
    schema.nodeFromJSON(updated).child(1).child(0).attrs.referenceFormat,
  ).toBe("labelNumber");
  const missing = {
    ...doc,
    content: [
      {
        ...doc.content[0],
        content: [{ type: "text", text: "Number deleted" }],
      },
      doc.content[1],
    ],
  };
  expect(
    referenceIndex([{ document: missing }]).resolve("caption", "number"),
  ).toBeNull();
});
it("copied objects and captions acquire independent target identities", () => {
  const image = schema.node("image", { blockId: "image", src: "asset:image" });
  const caption = schema.node(
    "paragraph",
    { blockId: "caption", captionLabel: "Figure", captionTargetId: "image" },
    schema.text("Figure 1: Title"),
  );
  const targets = copiedBookmarkTargets(
    schema.node("doc", null, [image, caption]).content,
  );
  expect(targets.links.get("image")).toBe(targets.nodes.get(image));
  expect(targets.links.get("caption")).toBe(targets.nodes.get(caption));
  expect(targets.links.get("image")).not.toBe("image");
});

it("splitting a caption keeps the numbered half as the single reference target", () => {
  const caption = schema.node(
    "paragraph",
    { captionLabel: "Figure", captionTargetId: "picture", blockId: "caption" },
    [
      schema.text("Figure "),
      schema.node("sequence", { sequenceName: "Figure" }, schema.text("1")),
      schema.text(": Title"),
    ],
  );
  for (const offset of [1, caption.nodeSize - 1, caption.nodeSize - 3]) {
    const doc = schema.node("doc", null, caption);
    let state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, offset),
    });
    expect(
      splitCaption(state, (tr) => {
        state = state.apply(tr);
      }),
    ).toBe(true);
    const captions: any[] = [];
    state.doc.forEach((node) => {
      if (node.attrs.captionLabel) captions.push(node);
    });
    expect(captions).toHaveLength(1);
    expect(captions[0].attrs.blockId).toBe("caption");
    expect(
      captions[0].content.content.some((n: any) => n.type.name === "sequence"),
    ).toBe(true);
    const ids: string[] = [];
    state.doc.forEach((node) => ids.push(node.attrs.blockId));
    expect(new Set(ids).size).toBe(2);
  }
});
