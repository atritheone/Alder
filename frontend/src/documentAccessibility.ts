import type { DocNode, Project } from "./types";
import { documentText } from "./textProjection";
import {
  storyParts,
  storyVariants,
  resolveRunningMatter,
  type StoryPart,
  type StoryVariant,
  type RunningMatter,
} from "./runningMatter";
export type AccessibilityTarget = {
  chapterId?: string;
  blockId?: string;
  noteId?: string;
  sectionId?: string;
  story?: StoryPart;
  variant?: StoryVariant;
};
export type AccessibilityIssue = AccessibilityTarget & {
  id: string;
  code: string;
  location: string;
  message: string;
  detail: string;
};
export type AccessibilitySource = {
  document: DocNode;
  title: string;
  chapterId?: string;
  headingLevel?: number;
};

/** Explicit structural checks; no scores or claim of screen-reader conformance.
 * Source objects and authored wording are never changed. */
export function accessibilityIssues(
  sources: AccessibilitySource[],
  running?: Project["settings"]["runningMatter"],
) {
  const issues: AccessibilityIssue[] = [];
  let serial = 0;
  let currentMatter: RunningMatter = running || {};
  const storyOwners = new Map<DocNode, AccessibilityTarget>(),
    seenStories = new Set<DocNode>();
  const add = (
    target: AccessibilityTarget,
    code: string,
    location: string,
    message: string,
    detail: string,
  ) =>
    issues.push({
      ...target,
      id: `a11y-${++serial}`,
      code,
      location,
      message,
      detail,
    });
  const visitStory = (
    matter: Project["settings"]["runningMatter"],
    target: AccessibilityTarget,
    location: string,
  ) => {
    currentMatter = resolveRunningMatter(currentMatter, matter);
    for (const part of storyParts)
      for (const variant of storyVariants) {
        const doc = currentMatter[part]?.[variant];
        if (!doc) continue;
        if (!storyOwners.has(doc))
          storyOwners.set(doc, { ...target, story: part, variant });
        if (
          seenStories.has(doc) ||
          (variant === "first" && !currentMatter.differentFirst) ||
          (variant === "even" && !currentMatter.differentEven)
        )
          continue;
        seenStories.add(doc);
        scan(
          doc,
          storyOwners.get(doc)!,
          `${location} · ${part} (${variant})`,
          0,
        );
      }
  };
  const scan = (
    document: DocNode,
    target: AccessibilityTarget,
    location: string,
    initialHeading: number,
  ) => {
    let previousHeading = initialHeading;
    const walk = (node: DocNode, anchor: AccessibilityTarget) => {
      if (node.marks?.some((mark) => mark.type === "revision_deletion")) return;
      const here = {
        ...anchor,
        blockId: node.attrs?.blockId || anchor.blockId,
      };
      if (node.type === "section_break")
        visitStory(
          node.attrs?.runningMatter,
          { ...target, sectionId: node.attrs?.blockId },
          location,
        );
      if (node.type === "document_note") {
        scan(
          node.attrs?.body,
          { ...here, noteId: node.attrs?.blockId },
          `${location} · ${node.attrs?.kind === "endnote" ? "Endnote" : "Footnote"}`,
          0,
        );
        return;
      }
      if (node.type === "heading") {
        const level = Number(node.attrs?.level || 1),
          text = documentText(node).trim();
        if (!text)
          add(
            here,
            "empty-heading",
            location,
            "Empty heading",
            "Write a descriptive heading or change this paragraph to body text.",
          );
        else if (level > previousHeading + 1)
          add(
            here,
            "heading-order",
            location,
            `Heading level ${level} skips a level`,
            previousHeading
              ? `A level ${previousHeading} heading precedes this one. Use the next heading level for its subsection.`
              : "Start the document outline with Heading 1.",
          );
        if (text) previousHeading = level;
      }
      if (
        ["image", "inline_image"].includes(node.type) &&
        !node.attrs?.decorative &&
        !String(node.attrs?.alt || "").trim()
      )
        add(
          here,
          "image-description",
          location,
          "Image needs a description",
          "Add alternative text in Image properties, or mark the image as decorative if it conveys no information.",
        );
      if (node.type === "table" && documentText(node).trim()) {
        const rows = node.content || [],
          first = rows[0]?.content || [];
        const columnHeaders =
          first.length > 0 && first.every((c) => c.type === "table_header");
        const rowHeaders =
          rows.length > 0 &&
          rows.every((r) => r.content?.[0]?.type === "table_header");
        if (!columnHeaders && !rowHeaders)
          add(
            here,
            "table-headers",
            location,
            "Table needs header cells",
            "Identify the first row or first column as headers so readers can associate cells with their labels.",
          );
        if (
          rows.some((r) =>
            r.content?.some(
              (c) =>
                Number(c.attrs?.rowspan || 1) > 1 ||
                Number(c.attrs?.colspan || 1) > 1,
            ),
          )
        )
          add(
            here,
            "table-merges",
            location,
            "Review merged table cells",
            "Check that every data cell has an unambiguous header. A simpler table can make navigation easier.",
          );
      }
      if (["paragraph", "heading"].includes(node.type)) {
        let href = "",
          label = "";
        const finish = () => {
          if (
            href &&
            /^(?:click here|here|link|read more|more)$/i.test(label.trim())
          )
            add(
              here,
              "link-purpose",
              location,
              "Link wording does not describe its destination",
              `Replace “${label.trim()}” with the destination or purpose of the link.`,
            );
          href = "";
          label = "";
        };
        for (const child of node.content || []) {
          if (child.marks?.some((m) => m.type === "revision_deletion"))
            continue;
          const link =
            child.marks?.find((m) => m.type === "link")?.attrs?.href || "";
          if (link !== href) {
            finish();
            href = link;
          }
          if (link)
            label += documentText(child) || String(child.attrs?.alt || "");
        }
        finish();
      }
      if (["table_of_contents", "bibliography", "citation"].includes(node.type))
        return;
      for (const child of node.content || []) walk(child, here);
    };
    if (document) walk(document, target);
  };
  visitStory(running, {}, "Document");
  for (const source of sources)
    scan(
      source.document,
      { chapterId: source.chapterId },
      source.title,
      source.headingLevel || 0,
    );
  return issues;
}

export function projectAccessibilitySources(
  project: Pick<Project, "book"> & {
    settings: { [key: string]: unknown; documentKind?: string };
  },
): AccessibilitySource[] {
  const book = !["txt", "docx"].includes(project.settings.documentKind || "");
  return (project.book?.chapters || [])
    .filter((c) => c.include !== false)
    .map((chapter) => ({
      document: chapter.document,
      title: book ? chapter.title || "Untitled chapter" : "Document",
      chapterId: chapter.id,
      headingLevel: book && chapter.showTitle !== false ? 1 : 0,
    }));
}
