import { it, expect, vi } from "vitest";
import { EditorState } from "prosemirror-state";
import type { DecorationSet } from "prosemirror-view";
import { schema } from "./Editor";
import { discretionaryHyphens, hasDiscretionaryBreak } from "./hyphenation";
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  api: async (_path: string, _method: string, body: { words: string[] }) => ({
    breaks: body.words.map((word) => [2, 4].filter((p) => p < word.length - 1)),
  }),
}));
const options = { styles: [], language: "en", enabled: true };
const makePlugin = () =>
  discretionaryHyphens(
    () => options,
    () => {},
    () => {},
  );
const get = (state: EditorState, plugin: ReturnType<typeof makePlugin>) =>
  plugin.props.decorations!.call(plugin, state) as DecorationSet;
const settle = async (
  state: EditorState,
  plugin: ReturnType<typeof makePlugin>,
) => {
  get(state, plugin);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return get(state, plugin);
};
const paragraph = (text: string) =>
  schema.nodes.paragraph.create({ hyphenation: true }, schema.text(text));
const positions = (set: DecorationSet) => set.find().map((d) => [d.from, d.to]);

it("maps unchanged hyphenation subtrees and matches a fresh layout after local edits", async () => {
  const plugin = makePlugin();
  let state = EditorState.create({
    doc: schema.nodes.doc.create(
      null,
      Array.from({ length: 8 }, () =>
        paragraph("paragraph representation measured words"),
      ),
    ),
    plugins: [plugin],
  });
  let decorated = await settle(state, plugin);
  for (const edit of [
    (s: EditorState) => s.tr.insertText("measured ", 5),
    (s: EditorState) => s.tr.addMark(2, 7, schema.marks.em.create()),
    (s: EditorState) =>
      s.tr.insert(s.doc.child(0).nodeSize, paragraph("measured paragraph")),
    (s: EditorState) => s.tr.delete(0, s.doc.child(0).nodeSize),
  ]) {
    const last = state.doc.lastChild!,
      oldOffset = state.doc.content.size - last.nodeSize;
    const oldSubtree = decorated.forChild(oldOffset, last);
    state = state.apply(edit(state));
    decorated = get(state, plugin);
    const newOffset = state.doc.content.size - last.nodeSize;
    expect(decorated.forChild(newOffset, last)).toBe(oldSubtree);
    const freshPlugin = makePlugin(),
      fresh = EditorState.create({ doc: state.doc, plugins: [freshPlugin] });
    const expected = await settle(fresh, freshPlugin);
    // Pending words may add new opportunities; every retained break still
    // agrees with a clean dictionary/layout after the response arrives.
    decorated = await settle(state, plugin);
    expect(decorated.forChild(newOffset, last)).toBe(oldSubtree);
    expect(positions(decorated)).toEqual(positions(expected));
    for (const d of decorated.find())
      expect(hasDiscretionaryBreak(state.doc, d.from)).toBe(true);
  }
});

it("drops removed language opportunities and handles multiple transactions before paint", async () => {
  const plugin = makePlugin();
  let state = EditorState.create({
    doc: schema.nodes.doc.create(null, [
      paragraph("paragraph measured"),
      paragraph("representation words"),
    ]),
    plugins: [plugin],
  });
  await settle(state, plugin);
  state = state.apply(state.tr.insertText("measured ", 1));
  state = state.apply(
    state.tr.setNodeMarkup(0, undefined, {
      ...state.doc.firstChild!.attrs,
      hyphenation: false,
    }),
  );
  const result = get(state, plugin),
    end = state.doc.firstChild!.nodeSize;
  expect(result.find(0, end).length).toBe(0);
  expect(result.find(end).length).toBeGreaterThan(0);
  const freshPlugin = makePlugin(),
    fresh = EditorState.create({ doc: state.doc, plugins: [freshPlugin] });
  expect(positions(result)).toEqual(
    positions(await settle(fresh, freshPlugin)),
  );
});
