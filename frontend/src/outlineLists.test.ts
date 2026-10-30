import { expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { schema } from "./Editor";
import {
  defaultListTemplate,
  validListTemplate,
  outlineListLayout,
  setListTemplate,
  selectedOutlineList,
  nextListLabel,
  listNumber,
  applyListOptions,
  ordinaryListLabels,
} from "./outlineLists";
const p = (text: string) => schema.node("paragraph", null, schema.text(text));
const item = (text: string, child?: any) =>
  schema.node("list_item", null, [p(text), ...(child ? [child] : [])]);
const list = (items: any[], attrs = {}) =>
  schema.node("ordered_list", attrs, items);
it("keeps ordinary list labels consistent with Word beyond Z and Roman 3999", () => {
  const doc = schema.node("doc", null, [
    list([item("one"), item("two"), item("three")], {
      order: 26,
      listStyle: "upper-alpha",
    }),
    list([item("roman")], { order: 4000, listStyle: "lower-roman" }),
    list([item("outline")], {
      listTemplate: defaultListTemplate(),
      listStyle: "upper-alpha",
    }),
  ]);
  expect(ordinaryListLabels(doc).map((item) => item.label)).toEqual([
    "Z. ",
    "AA. ",
    "BB. ",
    "mmmm. ",
  ]);
});
it("retains a bulleted root's outline start and continuation and matches Word's extended numbers", () => {
  const template = defaultListTemplate();
  const doc = schema.node("doc", null, [
    schema.node("bullet_list", { listTemplate: template, order: 27 }, [
      item("A"),
    ]),
    p("Gap"),
    schema.node(
      "bullet_list",
      { listTemplate: template, continuePrevious: true },
      [item("B")],
    ),
  ]);
  expect(outlineListLayout(doc).markers.map((m) => m.label)).toEqual([
    "27.",
    "28.",
  ]);
  expect([26, 27, 28].map((n) => listNumber(n, "upper-alpha"))).toEqual([
    "Z",
    "AA",
    "BB",
  ]);
  expect(listNumber(4000, "upper-roman")).toBe("MMMM");
});
it("formats every level using its own format and Word restart rules", () => {
  const template = defaultListTemplate(),
    counts = Array<number | null>(9).fill(null);
  template[1] = { ...template[1], format: "lower-alpha", pattern: "%1(%2)" };
  template[2] = {
    ...template[2],
    format: "lower-roman",
    pattern: "%1.%2.%3",
    restart: 0,
  };
  expect(
    [0, 1, 2, 2, 1, 2, 0, 1, 2].map((level) =>
      nextListLabel(template, counts, level),
    ),
  ).toEqual([
    "1.",
    "1(a)",
    "1.a.i",
    "1.a.ii",
    "1(b)",
    "1.b.iii",
    "2.",
    "2(a)",
    "2.a.iv",
  ]);
  expect(validListTemplate(template)).toBe(true);
  for (const patch of [
    { restart: 3 },
    { pattern: "%9" },
    { indent: NaN },
    { hanging: 400 },
    { format: "other" },
  ]) {
    const bad = structuredClone(template);
    Object.assign(bad[1], patch);
    expect(validListTemplate(bad)).toBe(false);
  }
});
it("continues the complete outline across separated lists and keeps text unchanged", () => {
  const template = defaultListTemplate();
  template[1].restart = 0;
  const doc = schema.node("doc", null, [
    list([item("A", list([item("a"), item("b")]))], {
      listTemplate: template,
      order: 3,
    }),
    p("Between"),
    list([item("B", list([item("c")]))], {
      listTemplate: template,
      continuePrevious: true,
    }),
  ]);
  expect(outlineListLayout(doc).markers.map((m) => m.label)).toEqual([
    "3.",
    "3.1.",
    "3.2.",
    "4.",
    "4.3.",
  ]);
  expect(doc.textContent).toBe("AabBetweenBc");
  expect(outlineListLayout(doc)).toBe(outlineListLayout(doc));
});
it("applies a template to the outer list with caret preservation and one undo", () => {
  const doc = schema.node("doc", null, [
    list([item("A", list([item("nested")]))]),
  ]);
  let inside = 0;
  doc.descendants((node, pos) => {
    if (node.isText && node.text === "nested") inside = pos + 2;
  });
  let state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, inside),
    plugins: [history()],
  });
  expect(selectedOutlineList(state)?.pos).toBe(0);
  expect(
    setListTemplate(
      defaultListTemplate(),
      1,
      false,
    )(state, (tr) => {
      state = state.apply(tr);
    }),
  ).toBe(true);
  expect(state.selection.from).toBe(inside);
  expect(outlineListLayout(state.doc).markers.map((m) => m.label)).toEqual([
    "1.",
    "1.1.",
  ]);
  undo(state, (tr) => {
    state = state.apply(tr);
  });
  expect(state.doc.eq(doc)).toBe(true);
});

it("updates linked continuation templates in one undo event, stopping at a restart", () => {
  const template = defaultListTemplate(),
    doc = schema.node("doc", null, [
      list([item("A")], { listTemplate: template, order: 3 }),
      p("Between"),
      list([item("B")], { listTemplate: template, continuePrevious: true }),
      list([item("C")], { listTemplate: template, order: 8 }),
      list([item("D")], { listTemplate: template, continuePrevious: true }),
    ]);
  let state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, 3),
    plugins: [history()],
  });
  const changed = structuredClone(template);
  changed[0].pattern = "(%1)";
  setListTemplate(
    changed,
    3,
    false,
  )(state, (tr) => {
    state = state.apply(tr);
  });
  expect(outlineListLayout(state.doc).markers.map((m) => m.label)).toEqual([
    "(3)",
    "(4)",
    "8.",
    "9.",
  ]);
  undo(state, (tr) => {
    state = state.apply(tr);
  });
  expect(state.doc.eq(doc)).toBe(true);
});

it("removes outline numbering and applies ordinary formatting in one undo", () => {
  const doc = schema.node("doc", null, [
    list([item("A", list([item("a")]))], {
      listTemplate: defaultListTemplate(),
    }),
  ]);
  let state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, 3),
    plugins: [history()],
  });
  expect(
    applyListOptions(
      "upper-roman",
      5,
      false,
      false,
      null,
    )(state, (tr) => {
      state = state.apply(tr);
    }),
  ).toBe(true);
  expect(outlineListLayout(state.doc).markers).toHaveLength(0);
  expect(state.doc.firstChild?.attrs.order).toBe(5);
  expect(state.selection.from).toBe(3);
  undo(state, (tr) => {
    state = state.apply(tr);
  });
  expect(state.doc.eq(doc)).toBe(true);
});
