import { it, expect } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { schema } from "./Editor";
import { blockIdentities, identifiedDocument } from "./blockIdentities";
import {
  addDocumentBookmark,
  changeDocumentBookmark,
  documentBookmarks,
  goToDocumentBookmark,
  copiedBookmarkTargets,
} from "./documentBookmarks";
import { projectText, projectedRange } from "./textProjection";
import { documentUnits, moveArrangementUnit } from "./arrangementUnits";
const initial = () => {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, schema.text("First last")),
    schema.node("paragraph", null, schema.text("Other")),
  ]);
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, 6),
    plugins: [history(), blockIdentities()],
  });
};
it("assigns copies new destinations while retaining links to targets outside the fragment", () => {
  const target = schema.node("bookmark", {
    name: "Target",
    blockId: "original",
  });
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [
      target,
      schema.text("Go", [schema.mark("link", { href: "#original" })]),
    ]),
  ]);
  const copy = copiedBookmarkTargets(doc.content);
  expect(copy.nodes.get(target)).not.toBe("original");
  expect(copy.links.get("original")).toBe(copy.nodes.get(target));
  expect(copy.links.get("Target")).toBe(copy.nodes.get(target));
  expect(copy.links.has("external-target")).toBe(false);
});
it("inserts at the cursor without replacing selected text, leaves speech unchanged, navigates and undoes", () => {
  let state = initial();
  const text = projectText(state.doc).text;
  const apply = (tr: any) => {
    state = state.applyTransaction(tr).state;
  };
  expect(addDocumentBookmark("Start")(state, apply)).toBe(true);
  const item = documentBookmarks(state.doc)[0];
  expect(item.name).toBe("Start");
  expect(projectText(state.doc).text).toBe(text);
  expect(goToDocumentBookmark(item.id)(state, apply)).toBe(true);
  expect(state.selection.from).toBe(item.pos + 1);
  expect(changeDocumentBookmark(item.id, "Renamed")(state, apply)).toBe(true);
  expect(documentBookmarks(state.doc)[0].id).toBe(item.id);
  undo(state, apply);
  expect(documentBookmarks(state.doc)[0].name).toBe("Start");
  undo(state, apply);
  expect(documentBookmarks(state.doc)).toEqual([]);
});
it("preserves identity on move, gives copies unique names/identities, and refuses invalid names", () => {
  let state = initial();
  addDocumentBookmark("Start")(state, (tr) => {
    state = state.applyTransaction(tr).state;
  });
  const first = state.doc.firstChild!,
    second = state.doc.lastChild!;
  const moved = identifiedDocument(schema.node("doc", null, [second, first]));
  expect(documentBookmarks(moved)[0].id).toBe(
    documentBookmarks(state.doc)[0].id,
  );
  const copied = identifiedDocument(schema.node("doc", null, [first, first]));
  const items = documentBookmarks(copied);
  expect(items.map((i) => i.name)).toEqual(["Start", "Start_2"]);
  expect(items[0].id).not.toBe(items[1].id);
  expect(addDocumentBookmark("start")(state)).toBe(false);
  expect(addDocumentBookmark("1 bad")(state)).toBe(false);
});
it("does not absorb a boundary bookmark when replacing the preceding word", () => {
  let state = initial();
  addDocumentBookmark("Start")(state, (tr) => {
    state = state.applyTransaction(tr).state;
  });
  const { from, to } = projectedRange(state.doc, 0, 5);
  state = state.applyTransaction(
    state.tr.insertText("Changed", from, to),
  ).state;
  expect(documentBookmarks(state.doc)).toHaveLength(1);
  expect(projectText(state.doc).text).toBe("Changed last\nOther");
});

it("binds pasted named links to a bookmark identity before it is renamed", () => {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [
      schema.node("bookmark", { name: "Target", blockId: "destination" }),
      schema.text("Read target", [schema.mark("link", { href: "#Target" })]),
    ]),
  ]);
  const identified = identifiedDocument(doc);
  expect(identified.firstChild!.lastChild!.marks[0].attrs.href).toBe(
    "#destination",
  );
  let state = EditorState.create({
    doc: identified,
    plugins: [blockIdentities()],
  });
  changeDocumentBookmark("destination", "Renamed")(state, (tr) => {
    state = state.applyTransaction(tr).state;
  });
  expect(state.doc.firstChild!.lastChild!.marks[0].attrs.href).toBe(
    "#destination",
  );
  // Clipboard insertion exercises the append-transaction path as well.
  state = initial();
  state = state.applyTransaction(
    state.tr.insert(state.doc.content.size, doc.content),
  ).state;
  expect(state.doc.lastChild!.lastChild!.marks[0].attrs.href).toBe(
    "#destination",
  );
});

it("moves a bookmarked sentence as one unit without adding a placeholder to its text", () => {
  const bookmark = schema.node("bookmark", {
    name: "Sentence",
    blockId: "bookmarked",
  });
  const doc = identifiedDocument(
    schema.node("doc", null, [
      schema.node("paragraph", null, [
        bookmark,
        schema.text("First sentence."),
      ]),
      schema.node("paragraph", null, schema.text("Second sentence.")),
    ]),
  );
  const state = EditorState.create({ doc });
  const units = documentUnits(doc).filter((u) => u.kind === "sentence");
  expect(units.map((u) => u.text)).toEqual([
    "First sentence.",
    "Second sentence.",
  ]);
  const moved = moveArrangementUnit(state, units[0], units[1].to)!;
  expect(documentBookmarks(moved.tr.doc)[0].id).toBe("bookmarked");
  expect(documentBookmarks(moved.tr.doc)[0].pos).toBeGreaterThan(
    documentBookmarks(doc)[0].pos,
  );
  expect(projectText(moved.tr.doc).text).toContain("First sentence.");
});

it("bookmarks a selected passage, follows edits, selects it on navigation and removes both ends with undo", () => {
  let state = initial();
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, 1, 6)),
  );
  const apply = (tr: any) => {
    state = state.applyTransaction(tr).state;
  };
  expect(addDocumentBookmark("Passage")(state, apply)).toBe(true);
  const item = documentBookmarks(state.doc)[0];
  expect(state.doc.textBetween(state.selection.from, state.selection.to)).toBe(
    "First",
  );
  expect(item.end).toBe(7);
  expect(item.incomplete).toBe(false);
  expect(projectText(state.doc).text).toBe("First last\nOther");
  state = state.apply(state.tr.insertText("new ", 2));
  goToDocumentBookmark(item.id)(state, apply);
  expect(state.doc.textBetween(state.selection.from, state.selection.to)).toBe(
    "new First",
  );
  changeDocumentBookmark(item.id, "Renamed")(state, apply);
  expect(
    state.doc.nodeAt(documentBookmarks(state.doc)[0].end!)!.attrs.name,
  ).toBe("Renamed");
  changeDocumentBookmark(item.id, null)(state, apply);
  expect(documentBookmarks(state.doc)).toHaveLength(0);
  undo(state, apply);
  expect(documentBookmarks(state.doc)[0].name).toBe("Renamed");
  expect(documentBookmarks(state.doc)[0].end).toBeDefined();
});

it("keeps copied ranges independent and carries complete ranges with sentences", () => {
  const paragraph = schema.node("paragraph", null, [
    schema.node("bookmark", {
      name: "Sentence",
      blockId: "start",
      range: true,
    }),
    schema.text("First sentence."),
    schema.node("bookmark_end", { targetId: "start", name: "Sentence" }),
  ]);
  const doc = identifiedDocument(
    schema.node("doc", null, [paragraph, paragraph]),
  );
  const ranges = documentBookmarks(doc);
  expect(ranges).toHaveLength(2);
  expect(ranges.every((r) => r.end != null && !r.incomplete)).toBe(true);
  expect(ranges[0].id).not.toBe(ranges[1].id);
  expect(ranges[1].name).toBe("Sentence_2");
  const units = documentUnits(doc).filter((u) => u.kind === "sentence");
  expect(units.map((u) => u.text)).toEqual([
    "First sentence.",
    "First sentence.",
  ]);
  const moved = moveArrangementUnit(
    EditorState.create({ doc }),
    units[0],
    units[1].to,
  )!;
  expect(
    documentBookmarks(moved.tr.doc).every(
      (r) => r.end != null && !r.incomplete,
    ),
  ).toBe(true);
});

it("retains and reports a damaged range so undo or removal can recover it", () => {
  let state = initial();
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, 1, 6)),
  );
  const apply = (tr: any) => {
    state = state.applyTransaction(tr).state;
  };
  addDocumentBookmark("Damaged")(state, apply);
  let item = documentBookmarks(state.doc)[0];
  apply(state.tr.delete(item.pos, item.pos + 1));
  item = documentBookmarks(state.doc)[0];
  expect(item.incomplete).toBe(true);
  expect(item.missingStart).toBe(true);
  expect(changeDocumentBookmark(item.id, null)(state, apply)).toBe(true);
  expect(documentBookmarks(state.doc)).toHaveLength(0);
  expect(projectText(state.doc).text).toBe("First last\nOther");
});
