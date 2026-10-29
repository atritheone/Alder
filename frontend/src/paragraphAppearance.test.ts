import { describe, it, expect } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { schema } from "./Editor";
import { setParagraph, selectionFormatting } from "./editorCommands";
import { resolveStyles, styleDeclarations } from "./styleResolution";
import { paragraphAppearanceFromDOM } from "./paragraphAppearance";

describe("paragraph borders and shading", () => {
  it("inherits, clears explicitly and rejects unsafe definitions", () => {
    const styles = [
      {
        id: "base",
        name: "Base",
        paragraphBackground: "#aabbcc",
        paragraphBorderWidth: 2,
        paragraphBorderColor: "#123456",
        paragraphPadding: 4,
      },
      {
        id: "child",
        name: "Child",
        basedOn: "base",
        paragraphBackground: "transparent",
        paragraphBorderWidth: 0,
      },
    ];
    const child = resolveStyles(styles).get("child")!;
    expect(child.paragraphPadding).toBe(4);
    expect(styleDeclarations(child)).toContain("outline-width:0pt");
    expect(styleDeclarations(child)).toContain("background-color:transparent");
    expect(() =>
      resolveStyles([
        { ...styles[0], paragraphBackground: "url(https://example.com)" },
      ]),
    ).toThrow();
    expect(() =>
      resolveStyles([{ ...styles[0], paragraphBorderWidth: 13 }]),
    ).toThrow();
    expect(styleDeclarations(child, "character")).not.toContain("border");
  });
  it("keeps wording, marks and earlier data unchanged, reports selection and undoes once", () => {
    const doc = schema.node("doc", null, [
      schema.node(
        "paragraph",
        null,
        schema.text("Authored", [schema.mark("em")]),
      ),
    ]);
    let state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 2),
      plugins: [history()],
    });
    const attrs = {
      paragraphBackground: "#eeddcc",
      paragraphBorderColor: "#123456",
      paragraphBorderWidth: 1.5,
      paragraphPadding: 6,
    };
    expect(
      setParagraph(attrs)(state, (tr) => {
        state = state.apply(tr);
      }),
    ).toBe(true);
    expect(selectionFormatting(state).paragraph).toMatchObject(attrs);
    expect(state.doc.textContent).toBe("Authored");
    expect(state.doc.firstChild!.firstChild!.marks[0].type.name).toBe("em");
    expect(doc.firstChild!.attrs.paragraphBackground).toBeNull();
    undo(state, (tr) => {
      state = state.apply(tr);
    });
    expect(state.doc.eq(doc)).toBe(true);
  });
  it("parses ordinary CSS units and explicit border removal", () => {
    const p = {
      style: {
        backgroundColor: "rgb(170, 187, 204)",
        borderTopColor: "rgb(18, 52, 86)",
        borderTopWidth: "2px",
        borderTopStyle: "solid",
        paddingTop: "8px",
      },
    } as HTMLElement;
    expect(paragraphAppearanceFromDOM(p)).toEqual({
      paragraphBackground: "#aabbcc",
      paragraphBorderColor: "#123456",
      paragraphBorderWidth: 1.5,
      paragraphPadding: 6,
    });
    p.style.borderTopStyle = "none";
    expect(paragraphAppearanceFromDOM(p).paragraphBorderWidth).toBe(0);
  });
});
