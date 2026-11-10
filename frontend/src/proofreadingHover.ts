import type { Annotation } from "./types";

/** A sentence revision takes priority over a nested word-level underline. */
export function proofreadingHoverIssue(annotations: Annotation[], id: string) {
  const direct = annotations.find((issue) => issue.id === id);
  if (!direct) return undefined;
  return (
    annotations.find(
      (issue) =>
        issue.kind === "sentence-revision" &&
        issue.start <= direct.start &&
        issue.end >= direct.end,
    ) || direct
  );
}
