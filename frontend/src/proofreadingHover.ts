import type { Annotation } from "./types";

/** Resolve the issue the pointer actually reached; never replace spelling. */
export function proofreadingHoverIssue(annotations: Annotation[], id: string) {
  return annotations.find((issue) => issue.id === id);
}

export function proofreadingHoverCandidates(
  annotations: Annotation[],
  issue: Annotation,
) {
  const sentence = annotations.find(
    (a) =>
      a.kind === "sentence-revision" &&
      a.start <= issue.start &&
      a.end >= issue.end,
  );
  const range = sentence || issue;
  return annotations
    .filter(
      (a) =>
        a.id === issue.id ||
        (a.start < range.end && a.end > range.start) ||
        (a.start === a.end && a.start >= range.start && a.start < range.end),
    )
    .sort(
      (a, b) =>
        Number(b.type === "spelling") - Number(a.type === "spelling") ||
        a.start - b.start ||
        a.end - b.end,
    );
}

/** ProseMirror merges overlapping decoration classes, but may keep only one id attribute. */
export function proofreadingPointerIssue(
  annotations: Annotation[],
  ids: string[],
) {
  return annotations
    .filter((a) => ids.includes(a.id))
    .sort(
      (a, b) =>
        Number(b.type === "spelling") - Number(a.type === "spelling") ||
        a.end - a.start - (b.end - b.start),
    )[0];
}
