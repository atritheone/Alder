import { EditorState } from "prosemirror-state";
import { parseEditorDocument } from "./Editor";
import { reviewChanges, resolveReviewChanges } from "./trackedReview";
import { documentText } from "./textProjection";
import type { DocNode, Project } from "./types";
export type BookReviewSnapshot = {
  id: string;
  title: string;
  document: DocNode;
};
/** Validate the complete snapshot and prepare every decision before mutation. */
export function resolveBookReview(
  project: Project,
  sources: BookReviewSnapshot[],
  ids: ReadonlySet<string>,
  decision: "accept" | "reject",
) {
  if (new Set(sources.map((s) => s.id)).size !== sources.length)
    throw Error("The review contains duplicate chapters. Open Review again.");
  if (
    JSON.stringify(project.book?.chapters.map((c) => c.id)) !==
    JSON.stringify(sources.map((s) => s.id))
  )
    throw Error("The book structure changed. Open Review again.");
  const found = new Set<string>(),
    prepared = [];
  for (const source of sources) {
    const chapter = project.book?.chapters.find((c) => c.id === source.id);
    if (!chapter)
      throw Error(
        "The book changed. Open Review again before applying this decision.",
      );
    const parsed = parseEditorDocument(source.document);
    if (!parsed.document)
      throw Error(parsed.error || "This chapter cannot be reviewed.");
    const current = parseEditorDocument(chapter.document).document;
    if (!current?.eq(parsed.document))
      throw Error(
        "The book changed. Open Review again before applying this decision.",
      );
    const targets = new Set(
      reviewChanges(parsed.document)
        .filter((c) => ids.has(c.id))
        .map((c) => c.id),
    );
    for (const id of targets) {
      if (found.has(id))
        throw Error(
          "The book contains shared review identities. Reopen it before reviewing.",
        );
      found.add(id);
    }
    if (!targets.size) continue;
    const doc = resolveReviewChanges(
      EditorState.create({ doc: parsed.document }),
      targets,
      decision,
    ).doc;
    doc.check();
    const json = doc.toJSON();
    if (!parseEditorDocument(json).document)
      throw Error(
        "This review decision would leave incomplete structure. No chapters were changed.",
      );
    prepared.push({ chapter, document: json });
  }
  if (found.size !== ids.size)
    throw Error(
      "Some selected changes are no longer present. Open Review again.",
    );
  for (const { chapter, document } of prepared) {
    chapter.document = document;
    chapter.text = documentText(document);
    delete chapter.rawSource;
    delete chapter.rawFormat;
  }
}
