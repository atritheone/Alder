import type { DocNode } from "./types";

/** Give generated rows and fields their identities before autosave normalizes them. */
export function identifiedGeneratedContents(node: DocNode): DocNode {
  const seen = new Set<string>();
  const visit = (current: DocNode): DocNode => {
    let attrs = current.attrs;
    if (
      [
        "table_of_contents",
        "paragraph",
        "cross_reference",
        "index_reference",
      ].includes(current.type)
    ) {
      let id = attrs?.blockId;
      if (typeof id !== "string" || !id || seen.has(id)) {
        do {
          id = `block_${crypto.randomUUID()}`;
        } while (seen.has(id));
        attrs = { ...attrs, blockId: id };
      }
      seen.add(id);
    }
    const content = current.content?.map(visit);
    return attrs === current.attrs &&
      (!content || content.every((child, i) => child === current.content![i]))
      ? current
      : {
          ...current,
          ...(attrs ? { attrs } : {}),
          ...(content ? { content } : {}),
        };
  };
  return visit(node);
}

/** Titles/placeholders are separate from entries, whose identities follow their targets. */
export function generatedLabelAttrs(node: DocNode, title: boolean) {
  const prior = node.content?.find(
    (child) =>
      child.type === "paragraph" &&
      !child.content?.some((part) =>
        ["cross_reference", "index_reference"].includes(part.type),
      ) &&
      !!child.content?.some((part) =>
        part.marks?.some((mark) => mark.type === "strong"),
      ) === title,
  );
  return prior?.attrs;
}
