import { expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { schema } from "./Editor";
import { identifiedDocument } from "./blockIdentities";
import {
  addDocumentComment,
  changeDocumentComment,
  documentComments,
  goToDocumentComment,
  commentEntry,
  validCommentThread,
} from "./documentComments";
import { projectText } from "./textProjection";
const thread = () => ({
  resolved: false,
  entries: [commentEntry("Writer", "Consider this.")],
});
const initial = () => {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, schema.text("One two three.")),
    schema.node("paragraph", null, schema.text("Four five.")),
  ]);
  return EditorState.create({
    doc,
    plugins: [history()],
    selection: TextSelection.create(doc, 5, 8),
  });
};
it("anchors a passage, maps edits, navigates and keeps review text out of narration", () => {
  let state = initial();
  const apply = (tr: any) => {
    state = state.apply(tr);
  };
  const text = projectText(state.doc).text;
  expect(addDocumentComment(thread())(state, apply)).toBe(true);
  const id = documentComments(state.doc)[0].id;
  expect(documentComments(state.doc)[0].context).toBe("two");
  apply(state.tr.insertText("changed ", 6));
  expect(documentComments(state.doc)[0].context).toBe("changed two");
  expect(goToDocumentComment(id)(state, apply)).toBe(true);
  expect(state.doc.textBetween(state.selection.from, state.selection.to)).toBe(
    "changed two",
  );
  expect(projectText(state.doc).text).toBe(text.replace("two", "changed two"));
  expect(documentComments(state.doc)).toBe(documentComments(state.doc));
});
it("replies, resolves, deletes and undoes the whole thread without touching body text", () => {
  let state = initial();
  const apply = (tr: any) => {
    state = state.apply(tr);
  };
  addDocumentComment(thread())(state, apply);
  const item = documentComments(state.doc)[0],
    text = projectText(state.doc).text;
  changeDocumentComment(item.id, {
    resolved: true,
    entries: [...item.thread.entries, commentEntry("Reader", "Done.")],
  })(state, apply);
  expect(
    documentComments(state.doc)[0].anchors.every(
      (a) => a.node.attrs.thread.resolved,
    ),
  ).toBe(true);
  changeDocumentComment(item.id, null)(state, apply);
  expect(documentComments(state.doc)).toEqual([]);
  undo(state, apply);
  expect(documentComments(state.doc)[0].thread.entries).toHaveLength(2);
  expect(projectText(state.doc).text).toBe(text);
});
it("keeps a lost endpoint visible and can reattach its review thread", () => {
  let state = initial();
  const apply = (tr: any) => {
    state = state.apply(tr);
  };
  addDocumentComment(thread())(state, apply);
  const item = documentComments(state.doc)[0];
  apply(state.tr.delete(item.anchors[0].pos, item.anchors[0].pos + 1));
  expect(documentComments(state.doc)[0].incomplete).toBe(true);
  expect(documentComments(state.doc)[0].thread.entries[0].text).toBe(
    "Consider this.",
  );
  apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 4)));
  addDocumentComment(item.thread, item.id)(state, apply);
  expect(documentComments(state.doc)[0].context).toBe("One");
  expect(documentComments(state.doc)[0].incomplete).toBe(false);
});
it("copied paragraphs get independent threads and reject malformed payloads", () => {
  let state = initial();
  addDocumentComment(thread())(state, (tr) => {
    state = state.apply(tr);
  });
  const first = state.doc.firstChild!;
  const copied = identifiedDocument(schema.node("doc", null, [first, first]));
  const items = documentComments(copied);
  expect(items).toHaveLength(2);
  expect(items.every((c) => !c.incomplete)).toBe(true);
  expect(items[0].id).not.toBe(items[1].id);
  expect(validCommentThread({ entries: [], resolved: false })).toBe(false);
});
