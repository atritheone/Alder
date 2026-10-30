// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  Schema,
  DOMParser as PMParser,
  DOMSerializer,
} from "prosemirror-model";
import { EditorState, NodeSelection } from "prosemirror-state";
import { history, undo, redo } from "prosemirror-history";
import { documentUnits, moveArrangementUnit } from "./arrangementUnits";
import {
  equationSpec,
  compileEquation,
  parseMath,
  validateEquation,
  putEquation,
  equationGuard,
  mathLatex,
} from "./equations";
import {
  projectText,
  generatedTextSpans,
  textLanguageSpans,
} from "./textProjection";
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      toDOM: () => ["p", 0],
      parseDOM: [{ tag: "p" }],
    },
    text: { group: "inline" },
    equation: equationSpec,
  },
});
const samples = [
  String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`,
  String.raw`\int_0^1 x^2 dx`,
  String.raw`\vec{v}+\overline{AB}`,
  String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`,
  String.raw`\sum_{i=1}^{n}\sqrt[3]{x}`,
];
describe("equations", () => {
  it.each(samples)(
    "keeps a complete formula through local parsing and clipboard: %s",
    async (source) => {
      const value = await compileEquation(source);
      parseMath(value.mathML);
      const n = schema.nodes.equation.create(
        value,
        schema.text(value.description),
      );
      validateEquation(n.toJSON());
      const container = document.createElement("div");
      container.append(DOMSerializer.fromSchema(schema).serializeNode(n));
      const restored =
        PMParser.fromSchema(schema).parse(container).firstChild!.firstChild!;
      expect(restored.attrs.mathML).toBe(n.attrs.mathML);
      expect(restored.textContent).toBe(value.description);
      expect(container.querySelector("math")).not.toBeNull();
      const recompiled = await compileEquation(
        mathLatex(parseMath(value.mathML)),
      );
      expect(recompiled.mathML).toContain("math");
    },
  );
  it("uses one stable projection for narration and excludes generated wording from checking", async () => {
    const value = await compileEquation(String.raw`\frac{a}{b}`),
      n = schema.nodes.equation.create(value, schema.text(value.description));
    const doc = schema.nodes.doc.create(
      null,
      schema.nodes.paragraph.create(null, [
        schema.text("Before "),
        n,
        schema.text(" after."),
      ]),
    );
    const projection = projectText(doc);
    expect(projection.text).toBe("Before " + value.description + " after.");
    expect(projection.map.length).toBe(projection.text.length + 1);
    expect(generatedTextSpans(doc.toJSON())).toEqual([
      { start: 7, end: 7 + value.description.length },
    ]);
    expect(textLanguageSpans(doc.toJSON(), new Map(), "en")[1].language).toBe(
      "zxx",
    );
  });
  it("inserts, edits, undoes and redoes an equation atom without editing its reading cache", async () => {
    let state = EditorState.create({
      schema,
      plugins: [history(), equationGuard],
    });
    const dispatch = (tr: any) => {
      state = state.apply(tr);
    };
    const value = await compileEquation("x^2");
    expect(putEquation(value, value.description)(state, dispatch)).toBe(true);
    expect(state.selection).toBeInstanceOf(NodeSelection);
    const before = state.doc;
    dispatch(state.tr.insertText("bad", 2));
    expect(state.doc.eq(before)).toBe(true);
    undo(state, dispatch);
    expect(state.doc.textContent).toBe("");
    redo(state, dispatch);
    expect(state.doc.eq(before)).toBe(true);
    const changed = await compileEquation("y^3");
    expect(
      putEquation(
        changed,
        "y cubed",
        state.doc.firstChild!.firstChild!.attrs.blockId,
      )(state, dispatch),
    ).toBe(true);
    expect(state.doc.textContent).toBe("y cubed");
  });
  it("rejects active markup, unsafe commands and oversized expressions", async () => {
    expect(() =>
      parseMath(
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi onclick="bad">x</mi></math>',
      ),
    ).toThrow();
    await expect(
      compileEquation(String.raw`\href{https://example.com}{x}`),
    ).rejects.toThrow();
    await expect(compileEquation("x".repeat(8193))).rejects.toThrow();
    expect(() =>
      parseMath(
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mtable><mi>x</mi></mtable></math>',
      ),
    ).toThrow();
  });
  it("imports standard MathML without reading alternate TeX annotations",()=>{
    const host=document.createElement('div');host.innerHTML='<p>Before <math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mfrac><mi>a</mi><mi>b</mi></mfrac><annotation encoding="application/x-tex">alternate</annotation></semantics></math> after.</p>';
    const doc=PMParser.fromSchema(schema).parse(host),eq=doc.firstChild!.child(1);
    expect(eq.type.name).toBe('equation');expect(eq.textContent).toBe('fraction a over b end fraction');expect(eq.attrs.mathML).not.toContain('alternate');
  });
  it("moves a whole equation with its sentence and keeps undo intact", async () => {
    const value = await compileEquation(String.raw`\frac{a}{b}`),
      n = schema.nodes.equation.create(
        { ...value, blockId: "equation_move" },
        schema.text("First term. Second term."),
      );
    let state = EditorState.create({
      doc: schema.nodes.doc.create(null, [
        schema.nodes.paragraph.create(null, [
          schema.text("Before "),
          n,
          schema.text(" After."),
        ]),
        schema.nodes.paragraph.create(null, schema.text("Destination.")),
      ]),
      plugins: [history(), equationGuard],
    });
    const before = state.doc,
      units = documentUnits(state.doc),
      unit = units.find((u) => u.kind === "sentence")!;
    expect(unit.text).toContain("First term. Second term.");
    state = state.applyTransaction(
      moveArrangementUnit(state, unit, state.doc.content.size - 1)!.tr,
    ).state;
    expect(state.doc.firstChild!.textContent).not.toContain("First term");
    expect(state.doc.lastChild!.textContent).toContain(
      "First term. Second term.",
    );
    expect(state.doc.lastChild!.child(1).type.name).toBe("equation");
    undo(state, (tr) => {
      state = state.applyTransaction(tr).state;
    });
    expect(state.doc.eq(before)).toBe(true);
  });
  it("places display math in its own paragraph without losing surrounding text",async()=>{
    let state=EditorState.create({doc:schema.nodes.doc.create(null,schema.nodes.paragraph.create(null,schema.text('Before after.'))),plugins:[history(),equationGuard]});
    state=state.apply(state.tr.setSelection((await import('prosemirror-state')).TextSelection.create(state.doc,8)));
    const before=state.doc,value=await compileEquation(String.raw`\sum_{i=1}^n i`,true);
    putEquation(value,value.description)(state,tr=>{state=state.applyTransaction(tr).state;});
    expect(state.doc.childCount).toBe(3);expect(state.doc.child(0).textContent).toBe('Before ');expect(state.doc.child(2).textContent).toBe('after.');
    expect(state.doc.child(1).firstChild!.attrs.mathML).toContain('display="block"');
    undo(state,tr=>{state=state.applyTransaction(tr).state;});expect(state.doc.eq(before)).toBe(true);
  });
  it.each(['double-struck','script','fraktur','sans-serif','sans-serif-italic','monospace'])('retains the %s alphabet when editing imported MathML',async variant=>{
    const source=parseMath(`<math xmlns="http://www.w3.org/1998/Math/MathML"><mstyle mathvariant="${variant}"><mi>R</mi></mstyle></math>`);
    const compiled=await compileEquation(mathLatex(source));
    expect(compiled.mathML).toContain(`mathvariant="${variant}"`);
  });
});
