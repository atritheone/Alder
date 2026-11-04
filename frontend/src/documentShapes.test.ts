// @vitest-environment jsdom
import { it, expect } from "vitest";
import { EditorState, TextSelection, NodeSelection } from "prosemirror-state";
import { history, undo, redo } from "prosemirror-history";
import { DOMSerializer } from "prosemirror-model";
import { schema, parseEditorDocument } from "./Editor";
import { putShape, shapeProperties, shapeKinds } from "./documentShapes";
import { clipboardSlice } from "./pasteText";
import { projectText } from "./textProjection";
import { accessibilityIssues } from "./documentAccessibility";
import { captionObject, addCaption } from "./documentCaptions";
import { identifiedDocument } from "./blockIdentities";

it.each(shapeKinds)(
  "inserts, copies and edits a %s without changing surrounding wording",
  (kind) => {
    const doc = schema.node(
      "doc",
      null,
      schema.node("paragraph", null, schema.text("Before after.")),
    );
    let state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 8),
      plugins: [history()],
    });
    const dispatch = (tr: any) => {
      state = state.apply(tr);
    };
    expect(putShape({ kind, alt: "A diagram" })(state, dispatch)).toBe(true);
    const inserted = state.doc;
    expect(projectText(inserted).text).toBe("Before after.");
    expect(parseEditorDocument(inserted.toJSON()).document?.eq(inserted)).toBe(
      true,
    );
    const id = inserted.nodeAt(8)!.attrs.blockId;
    expect(
      putShape({ kind, width: 240, alt: "Edited diagram" }, id)(
        state,
        dispatch,
      ),
    ).toBe(true);
    expect(state.doc.nodeAt(8)!.attrs.blockId).toBe(id);
    undo(state, dispatch);
    expect(state.doc.eq(inserted)).toBe(true);
    redo(state, dispatch);
    expect(state.doc.nodeAt(8)!.attrs.width).toBe(240);
    const root = document.createElement("div");
    root.append(
      DOMSerializer.fromSchema(schema).serializeFragment(state.doc.content),
    );
    expect(root.querySelectorAll("svg path")).toHaveLength(1);
    expect(root.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(
      "Edited diagram",
    );
    const copy = identifiedDocument(
      schema.node(
        "doc",
        null,
        clipboardSlice(schema, "", root.innerHTML, "source").content,
      ),
    );
    const copied = copy.firstChild!.child(1);
    expect(copied.type.name).toBe("shape");
    expect(copied.attrs.width).toBe(240);
    expect(copied.attrs.blockId).not.toBe(id);
    const issues = accessibilityIssues([
      { title: "Test", document: copy.toJSON() },
    ]);
    expect(issues).toEqual([]);
  },
);
it("requires bounded shape properties and reports undescribed nondecorative shapes", () => {
  for (const value of [
    { kind: "script" },
    { width: Infinity },
    { height: 0 },
    { strokeWidth: 13 },
    { fill: "url(x)" },
    { decorative: "false" },
    { onload: "bad" },
  ])
    expect(() => shapeProperties(value)).toThrow();
  const doc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "shape", attrs: shapeProperties({}) }],
      },
    ],
  };
  expect(
    accessibilityIssues([{ title: "Test", document: doc }]).map((x) => x.code),
  ).toEqual(["shape-description"]);
  doc.content[0].content[0].attrs.decorative = true;
  expect(accessibilityIssues([{ title: "Test", document: doc }])).toEqual([]);
});

it("anchors a shape caption and remaps both identities on copying", () => {
  const doc = schema.node(
    "doc",
    null,
    schema.node(
      "paragraph",
      null,
      schema.node("shape", { blockId: "diagram", alt: "Diagram" }),
    ),
  );
  let state = EditorState.create({
    doc,
    selection: NodeSelection.create(doc, 1),
  });
  expect(captionObject(state)?.id).toBe("diagram");
  expect(
    addCaption(
      "diagram",
      "Figure",
      "A diagram",
      "after",
    )(state, (tr) => {
      state = state.apply(tr);
    }),
  ).toBe(true);
  expect(state.doc.child(1).attrs.captionTargetId).toBe("diagram");
  const root = document.createElement("div");
  root.append(
    DOMSerializer.fromSchema(schema).serializeFragment(state.doc.content),
  );
  const copy = identifiedDocument(
    schema.node(
      "doc",
      null,
      clipboardSlice(schema, "", root.innerHTML, "source").content,
    ),
  );
  expect(copy.child(1).attrs.captionTargetId).toBe(
    copy.firstChild!.firstChild!.attrs.blockId,
  );
  expect(copy.child(1).attrs.captionTargetId).not.toBe("diagram");
});
