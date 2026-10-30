import { expect, it } from "vitest";
import { EditorState, NodeSelection } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { schema, parseEditorDocument } from "./Editor";
import { putTextBox } from "./textBoxes";
import {
  projectText,
  documentText,
  projectedRange,
  textLanguageSpans,
  generatedTextSpans,
} from "./textProjection";
import { documentUnits, moveArrangementUnit } from "./arrangementUnits";
import { proofreadingTransaction } from "./proofreadingEdits";
import { replaceMatches } from "./findText";
import { speechText } from "./speechText";
import { imageAnchors } from "./imageAnchors";

it("preserves real word offsets, marked text and one-step undo when changing a box", () => {
  const box = schema.nodes.text_box.create({ blockId: "box" }, [
    schema.text("Alpha ", [schema.marks.strong.create()]),
    schema.text("omega"),
  ]);
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, [
      schema.text("Before "),
      box,
      schema.text(" after."),
    ]),
  ]);
  const projection = projectText(doc);
  expect(projection.text).toBe(documentText(doc.toJSON()));
  expect(projection.text).toBe("Before \nAlpha omega\n after.");
  const range = projectedRange(doc, 14, 19);
  expect(doc.textBetween(range.from, range.to)).toBe("omega");
  let state = EditorState.create({ doc, plugins: [history()] });
  expect(
    putTextBox(
      { wrap: "right", width: 180 },
      box.toJSON().content!,
      "box",
    )(state, (tr) => (state = state.apply(tr))),
  ).toBe(true);
  expect(state.doc.firstChild!.firstChild!.attrs.wrap).toBe("right");
  expect(state.selection).toBeInstanceOf(NodeSelection);
  expect(state.doc.firstChild!.firstChild!.firstChild!.marks[0].type.name).toBe(
    "strong",
  );
  expect(undo(state, (tr) => (state = state.apply(tr)))).toBe(true);
  expect(state.doc.eq(doc)).toBe(true);
});

it("moves a sentence containing a whole box without cutting its nested text", () => {
  const box = schema.nodes.text_box.create(
    { blockId: "box", wrap: "left" },
    schema.text("Box. Two sentences."),
  );
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, [
      box,
      schema.text("First sentence. Next sentence."),
    ]),
    schema.nodes.paragraph.create(null, schema.text("Destination.")),
  ]);
  let state = EditorState.create({ doc, plugins: [history(), imageAnchors()] });
  const units = documentUnits(doc),
    unit = units.find((u) => u.kind === "sentence")!;
  expect(unit.to).toBeGreaterThan(box.nodeSize);
  const moved = moveArrangementUnit(state, unit, doc.content.size - 1);
  expect(moved).not.toBeNull();
  state = state.applyTransaction(moved!.tr).state;
  const boxes: any[] = [];
  state.doc.descendants((n) => {
    if (n.type.name === "text_box") boxes.push(n);
  });
  expect(boxes).toHaveLength(1);
  expect(boxes[0].textContent).toBe("Box. Two sentences.");
  expect(undo(state, (tr) => (state = state.applyTransaction(tr).state))).toBe(
    true,
  );
  expect(state.doc.eq(doc)).toBe(true);
});

it("rejects nested objects and invalid geometry before parsing", () => {
  for (const box of [
    { type: "text_box", attrs: { width: 0 } },
    { type: "text_box", content: [{ type: "inline_image" }] },
  ])
    expect(
      parseEditorDocument({
        type: "doc",
        content: [{ type: "paragraph", content: [box] }],
      }).document,
    ).toBeNull();
});

it("allows exact corrections inside the box without replacing its container", () => {
  const box = schema.nodes.text_box.create(
    { blockId: "box" },
    schema.text("Alpha omega"),
  );
  const state = EditorState.create({
    doc: schema.nodes.doc.create(
      null,
      schema.nodes.paragraph.create(null, [box, schema.text(" after")]),
    ),
  });
  const expected = projectText(state.doc).text;
  const corrected = state.apply(
    proofreadingTransaction(state, expected, [
      { start: 7, end: 12, originalText: "omega", replacement: "ending" },
    ]),
  );
  expect(corrected.doc.firstChild!.firstChild!.type.name).toBe("text_box");
  expect(corrected.doc.firstChild!.firstChild!.textContent).toBe(
    "Alpha ending",
  );
  const replaced = state.apply(
    replaceMatches(state, [{ start: 1, end: 6 }], "Beginning", expected),
  );
  expect(replaced.doc.firstChild!.firstChild!.textContent).toBe(
    "Beginning omega",
  );
  expect(speechText(state.doc).text).toBe(expected);
  expect(() =>
    replaceMatches(state, [{ start: 6, end: 14 }], "broken", expected),
  ).toThrow();
});

it("keeps language and generated-reference offsets aligned after boxed text", () => {
  const box = { type: "text_box", content: [{ type: "text", text: "Box" }] };
  const doc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { textLanguage: "fr" },
        content: [
          box,
          { type: "text", text: "After" },
          {
            type: "document_field",
            attrs: { fieldKind: "title" },
            content: [{ type: "text", text: "Title" }],
          },
        ],
      },
    ],
  };
  const text = documentText(doc);
  expect(textLanguageSpans(doc, new Map(), "en")).toEqual([
    { start: 0, end: text.length, language: "fr" },
  ]);
  expect(generatedTextSpans(doc)).toEqual([]);
  expect(projectText(schema.nodeFromJSON(doc)).text).toBe(text);
});
