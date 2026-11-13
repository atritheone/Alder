import { EditorState } from "@codemirror/state";
import { bookmarkField, markField } from "./plainTextMarks";

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
export function persistTextMetadata(
  identity: string,
  state: EditorState,
): Promise<void> {
  const value = state.toJSON(fields);
  const work = (writes.get(identity) || Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const hash = await digest(state.doc.toString());
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
      value.hash !== (await digest(state.doc.toString()))
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
