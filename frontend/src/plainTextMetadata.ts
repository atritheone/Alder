import { EditorState, type Text } from "@codemirror/state";
import { bookmarkField, markField, serializeMarks } from "./plainTextMarks";

const fields = { bookmarks: bookmarkField, marks: markField };
const key = (identity: string) => "alder.txt.metadata." + identity;
async function digest(text: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
const writes = new Map<string, Promise<void>>();
const hashes = new WeakMap<Text, Promise<string>>();
function documentDigest(doc: Text) {
  let hash = hashes.get(doc);
  if (!hash) {
    hash = digest(doc.toString());
    hashes.set(doc, hash);
  }
  return hash;
}
export function persistTextMetadata(
  identity: string,
  state: EditorState,
): Promise<void> {
  const value = {
    selection: state.selection.toJSON(),
    bookmarks: state.field(bookmarkField),
    marks: serializeMarks(state.field(markField)),
  };
  const work = (writes.get(identity) || Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const hash = await documentDigest(state.doc);
      localStorage.setItem(
        key(identity),
        JSON.stringify({
          version: 1,
          hash,
          selection: value.selection,
          bookmarks: value.bookmarks,
          marks: value.marks,
        }),
      );
    });
  writes.set(identity, work);
  void work
    .finally(() => {
      if (writes.get(identity) === work) writes.delete(identity);
    })
    .catch(() => {});
  return work;
}
export async function readTextMetadata(identity: string, state: EditorState) {
  try {
    await writes.get(identity);
    const value = JSON.parse(localStorage.getItem(key(identity)) || "null");
    if (
      value?.version !== 1 ||
      value.hash !== (await documentDigest(state.doc))
    )
      return null;
    return EditorState.fromJSON(
      {
        ...state.toJSON(),
        selection: value.selection || state.selection.toJSON(),
        bookmarks: value.bookmarks,
        marks: value.marks,
      },
      {
        extensions: [
          bookmarkField,
          markField,
          EditorState.allowMultipleSelections.of(true),
        ],
      },
      fields,
    );
  } catch {
    return null;
  }
}
