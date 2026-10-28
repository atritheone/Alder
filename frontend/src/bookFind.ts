import { EditorState } from "prosemirror-state";
import { parseEditorDocument } from "./Editor";
import { replaceMatches, type TextMatch } from "./findText";
import { documentText } from "./textProjection";
import type { Project } from "./types";

export type BookSearchGroup = {
  id: string;
  text: string;
  matches: TextMatch[];
};
/** Prepare every chapter before mutating, so stale results cannot partly apply. */
export function replaceBookMatches(
  project: Project,
  groups: BookSearchGroup[],
  replacement: string,
) {
  if (new Set(groups.map((group) => group.id)).size !== groups.length)
    throw new Error(
      "The search contains duplicate chapters. Search again before replacing.",
    );
  const prepared = groups.map((group) => {
    const chapter = project.book?.chapters.find(
      (chapter) => chapter.id === group.id,
    );
    if (!chapter || documentText(chapter.document) !== group.text)
      throw new Error("The book changed. Search again before replacing.");
    const parsed = parseEditorDocument(chapter.document);
    if (!parsed.document)
      throw new Error(parsed.error || "This chapter cannot be edited.");
    const state = EditorState.create({ doc: parsed.document });
    const doc = replaceMatches(
      state,
      group.matches,
      replacement,
      group.text,
    ).doc.toJSON();
    return { chapter, doc };
  });
  for (const { chapter, doc } of prepared) {
    chapter.document = doc;
    chapter.text = documentText(doc);
    delete chapter.rawSource;
    delete chapter.rawFormat;
  }
}
