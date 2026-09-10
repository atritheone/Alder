import { describe, it, expect } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import {
  resolveStyles,
  styleDeclarations,
  styleSheet,
  styleUsageCount,
} from "./styleResolution";
import { schema, namedStyleTransaction, parseEditorDocument } from "./Editor";
import type { NamedStyle, Project, DocNode } from "./types";

const paragraph = (text: string, attrs: Record<string, unknown> = {}) =>
  schema.nodes.paragraph.create(attrs, schema.text(text));
const select = (
  doc: ReturnType<typeof schema.node>,
  from: number,
  to: number,
) =>
  EditorState.create({ doc, selection: TextSelection.create(doc, from, to) });

describe("named style inheritance and live presentation", () => {
  it("resolves base→child without modifying styles and treats zero as explicit", () => {
    const styles: NamedStyle[] = [
      {
        id: "body",
        name: "Body",
        fontFamily: "Georgia",
        fontSize: 12,
        lineHeight: 1.6,
        spaceAfter: 8,
        color: "#223344",
      },
      {
        id: "lead",
        name: "Lead",
        basedOn: "body",
        fontSize: 18,
        spaceAfter: 0,
        color: null,
      },
      {
        id: "nested",
        name: "Nested",
        basedOn: "lead",
        fontFamily: "",
        leftIndent: 12,
      },
    ];
    const source = JSON.stringify(styles),
      result = resolveStyles(styles).get("nested")!;
    expect(result).toMatchObject({
      kind: "paragraph",
      fontFamily: "Georgia",
      fontSize: 18,
      lineHeight: 1.6,
      spaceAfter: 0,
      color: "#223344",
      leftIndent: 12,
    });
    expect(JSON.stringify(styles)).toBe(source);
  });
  it("rejects cycles, missing bases, duplicate ids, and out-of-range output values", () => {
    expect(() =>
      resolveStyles([
        { id: "a", name: "A", basedOn: "b" },
        { id: "b", name: "B", basedOn: "a" },
      ]),
    ).toThrow(/cycle/);
    expect(() =>
      resolveStyles([{ id: "a", name: "A", basedOn: "missing" }]),
    ).toThrow(/missing base/);
    expect(() =>
      resolveStyles([
        { id: "a", name: "A" },
        { id: "a", name: "Another" },
      ]),
    ).toThrow(/unique identity/);
    expect(() =>
      resolveStyles([{ id: "a", name: "A", fontSize: 100 }]),
    ).toThrow(/invalid fontSize/);
    expect(() =>
      resolveStyles([{ id: "a", name: "A", color: "#12345" }]),
    ).toThrow(/colour/);
  });
  it("updates descendant CSS when a base changes, with separate editor scopes and character selectors", () => {
    const styles: NamedStyle[] = [
      { id: "body", name: "Body", fontSize: 12 },
      { id: "child", name: "Child", basedOn: "body" },
      { id: "term", name: "Term", kind: "character", color: "#325544" },
    ];
    const first = styleSheet(styles, "one");
    styles[0].fontSize = 16;
    const changed = styleSheet(styles, "one"),
      separate = styleSheet(styles, "two");
    expect(first).toContain('[data-style="child"]{font-size:12pt}');
    expect(changed).toContain('[data-style="child"]{font-size:16pt}');
    expect(changed).toContain('span[data-style="term"]{color:#325544}');
    expect(separate).toContain('[data-alder-editor="two"]');
    expect(separate).not.toContain('[data-alder-editor="one"]');
  });
  it("uses point spacing, unitless line height, and safe quoted font names", () => {
    const css = styleDeclarations({
      fontFamily: 'A "quoted" font',
      fontSize: 12,
      lineHeight: 1.5,
      spaceAfter: 0,
      leftIndent: 18,
      firstLineIndent: -6,
      color: "rgb(20, 30, 40)",
    });
    expect(css).toContain('font-family:"A \\22 quoted\\22  font"');
    expect(css).toContain("line-height:1.5;");
    expect(css).toContain("margin-bottom:0pt");
    expect(css).toContain("margin-left:18pt");
    expect(css).toContain("text-indent:-6pt");
    expect(styleDeclarations({ color: "red;position:fixed" })).toBe("");
  });
});

describe("named styles preserve source and direct formatting", () => {
  it("applies and clears a paragraph reference at the caret while retaining direct overrides", () => {
    const doc = schema.nodes.doc.create(null, [
      paragraph("First", { fontSize: 15, align: "right" }),
      paragraph("Second"),
    ]);
    let state = select(doc, 3, 3);
    state = state.apply(namedStyleTransaction(state, "body", "paragraph"));
    expect(state.doc.firstChild?.attrs).toMatchObject({
      styleId: "body",
      fontSize: 15,
      align: "right",
    });
    expect(state.doc.child(1).attrs.styleId).toBeNull();
    state = state.apply(namedStyleTransaction(state, "", "paragraph"));
    expect(state.doc.firstChild?.attrs).toMatchObject({
      styleId: null,
      fontSize: 15,
      align: "right",
    });
    expect(state.doc.textContent).toBe("FirstSecond");
  });
  it("adds a character style without overwriting different direct formatting on adjacent words", () => {
    const mark = schema.marks.text_style;
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text("red ", [mark.create({ color: "#cc0000" })]),
        schema.text("large", [mark.create({ fontSize: 18 })]),
      ]),
    ]);
    let state = select(doc, 1, 10);
    state = state.apply(namedStyleTransaction(state, "term", "character"));
    expect(state.doc.firstChild?.child(0).marks[0].attrs).toMatchObject({
      styleId: "term",
      color: "#cc0000",
      fontSize: null,
    });
    expect(state.doc.firstChild?.child(1).marks[0].attrs).toMatchObject({
      styleId: "term",
      fontSize: 18,
      color: null,
    });
    state = state.apply(namedStyleTransaction(state, "", "character"));
    expect(state.doc.firstChild?.child(0).marks[0].attrs).toMatchObject({
      styleId: null,
      color: "#cc0000",
    });
    expect(state.doc.firstChild?.child(1).marks[0].attrs).toMatchObject({
      styleId: null,
      fontSize: 18,
    });
  });
  it("preserves paragraph layout attributes and character style references during parse", () => {
    const source: DocNode = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: {
            level: 2,
            styleId: "title",
            firstLineIndent: 12,
            leftIndent: 18,
            lineHeight: 1.4,
            spaceAfter: 8,
            fontSize: 24,
          },
          content: [
            {
              type: "text",
              text: "Named words",
              marks: [
                {
                  type: "text_style",
                  attrs: { styleId: "term", color: "#246842" },
                },
              ],
            },
          ],
        },
      ],
    };
    const parsed = parseEditorDocument(source);
    expect(parsed.error).toBeNull();
    expect(parsed.document?.firstChild?.attrs).toMatchObject(
      source.content![0].attrs!,
    );
    expect(
      parsed.document?.firstChild?.firstChild?.marks[0].attrs.styleId,
    ).toBe("term");
  });
  it("counts references in originals, variants, character marks, and frozen placements for safe deletion", () => {
    const doc: DocNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { styleId: "body" },
          content: [
            {
              type: "text",
              text: "word",
              marks: [{ type: "text_style", attrs: { styleId: "term" } }],
            },
          ],
        },
      ],
    };
    const project = {
      clips: [{ document: doc, variants: [{ document: doc }] }],
      placements: [{ frozenDocument: doc }],
    } as Project;
    expect(styleUsageCount(project, "body")).toBe(3);
    expect(styleUsageCount(project, "term")).toBe(3);
    expect(styleUsageCount(project, "unused")).toBe(0);
  });
});
