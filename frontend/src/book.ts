import type { Chapter, DocNode, Project } from "./types";
import { chosenClip, orderedPlacements, textDoc, uid } from "./api";
import { documentText } from "./textProjection";

export function newChapter(
  title = "Chapter 1",
  document = textDoc(""),
): Chapter {
  return {
    id: uid(),
    title,
    role: "chapter",
    document,
    text: documentText(document),
    include: true,
    voiceId: null,
  };
}

/** One-time, lossless copy of the old publication order. Scratch originals stay intact. */
export function migrateBook(project: Project): Project {
  if (project.book) return project;
  const chapters = [...project.sections]
    .sort((a, b) => a.order - b.order)
    .map((section) => {
      const blocks: DocNode[] = [];
      for (const placement of orderedPlacements(project).filter(
        (p) => p.sectionId === section.id && p.include,
      )) {
        const source = project.clips.find((c) => c.id === placement.clipId);
        if (!source)
          throw new Error(
            "An existing manuscript passage is missing. The project has not been converted.",
          );
        const pinned = (placement as any).variantId;
        const version = pinned
          ? source.variants.find((v) => v.id === pinned)
          : chosenClip(source);
        if (!version && !placement.frozenDocument)
          throw new Error("An existing manuscript version is missing.");
        const document = placement.frozenDocument || version!.document;
        blocks.push(...structuredClone(document.content || []));
      }
      return {
        ...newChapter(section.title, {
          type: "doc",
          content: blocks.length ? blocks : [{ type: "paragraph" }],
        }),
        role: section.role,
      };
    });
  return {
    ...project,
    settings: {
      ...project.settings,
      chapterPageBreaks: project.settings.chapterPageBreaks ?? true,
    },
    book: { version: 1, chapters: chapters.length ? chapters : [newChapter()] },
  };
}

export function bookText(project: Project) {
  return (
    project.book?.chapters
      .filter((c) => c.include)
      .map((c) => c.text)
      .join("\n\n") || ""
  );
}
