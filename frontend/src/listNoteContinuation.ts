import type { DocNode } from "./types";
import { documentText } from "./textProjection";
import { validListTemplate } from "./outlineLists";

/** Sequential list stories can resume by paragraph offsets. Parallel cell
 * stories require independent cursors and are deliberately excluded here. */
export function continueListedNote(source: DocNode, from: number, images = 0) {
  const paragraphs = new Map<DocNode, number>();
  const originalParagraphs = new Map<DocNode, number>();
  const origins = new Map<DocNode, number>();
  const paragraphImages = new Map<DocNode, number>();
  const pictureOffsets = new Map<DocNode, { from: number; images: number }>();
  const pictureCounts = new Map<DocNode, number>();
  const picture = (node: DocNode) =>
    ["image", "inline_image"].includes(node.type);
  const hidden = new Set<DocNode>(),
    suppress = new Set<DocNode>();
  const allowed = new Set([
    "doc",
    "paragraph",
    "text",
    "hard_break",
    "ordered_list",
    "bullet_list",
    "list_item",
    "image",
    "inline_image",
  ]);
  const validate = (node: DocNode) => {
    if (!allowed.has(node.type))
      throw new Error(
        "A footnote containing tables cannot continue across different page widths yet. Keep the section text widths equal before publishing.",
      );
    if (node.attrs?.listTemplate && !validListTemplate(node.attrs.listTemplate))
      throw new Error("The footnote contains invalid outline numbering.");
    if (node.type === "paragraph")
      originalParagraphs.set(node, originalParagraphs.size);
    node.content?.forEach(validate);
    pictureCounts.set(
      node,
      picture(node)
        ? 1
        : (node.content || []).reduce(
            (sum, child) => sum + pictureCounts.get(child)!,
            0,
          ),
    );
  };
  validate(source);
  const walk = (
    node: DocNode,
    start: number,
    image: number,
  ): DocNode | null => {
    const length = documentText(node).length;
    if (
      start + length < from ||
      (length > 0 &&
        start + length === from &&
        image + pictureCounts.get(node)! <= images)
    )
      return null;
    if (picture(node)) {
      if (start < from || image < images) return null;
      pictureOffsets.set(node, { from: start, images: image });
      return node;
    }
    if (node.type === "paragraph") {
      let at = start,
        pictureIndex = image,
        firstImage: number | undefined;
      const content: DocNode[] = [];
      for (const child of node.content || []) {
        const size = documentText(child).length;
        if (picture(child)) {
          const tail = walk(child, at, pictureIndex);
          if (tail) {
            firstImage ??= pictureIndex;
            content.push(tail);
          }
          pictureIndex++;
          continue;
        }
        if (at + size > from) {
          firstImage ??= pictureIndex;
          const skip = Math.max(0, from - at);
          content.push(
            skip && child.type === "text"
              ? { ...child, text: child.text!.slice(skip) }
              : child,
          );
        }
        at += size;
      }
      const result = {
        ...node,
        attrs: {
          ...node.attrs,
          ...(from > start ? { firstLineIndent: 0, spaceBefore: 0 } : {}),
        },
        content,
      };
      paragraphs.set(result, Math.max(start, from));
      origins.set(result, originalParagraphs.get(node)!);
      paragraphImages.set(result, firstImage ?? pictureIndex);
      return result;
    }
    let at = start,
      first = -1,
      pictureIndex = image;
    const content: DocNode[] = [];
    node.content?.forEach((child, index) => {
      if (index) at++;
      const tail = walk(child, at, pictureIndex);
      if (tail) {
        if (first < 0) first = index;
        content.push(tail);
        if (child.type === "list_item" && (from > at || images > pictureIndex))
          suppress.add(tail);
      }
      at += documentText(child).length;
      pictureIndex += pictureCounts.get(child)!;
    });
    if (!content.length) return null;
    if (node.type === "list_item" && content[0].type !== "paragraph") {
      const empty: DocNode = { type: "paragraph", content: [] };
      paragraphs.set(empty, from);
      paragraphImages.set(empty, images);
      hidden.add(empty);
      content.unshift(empty);
    }
    return {
      ...node,
      attrs:
        node.type === "ordered_list"
          ? {
              ...node.attrs,
              order: Number(node.attrs?.order || 1) + first,
              continuePrevious: false,
            }
          : node.attrs,
      content,
    };
  };
  const document = walk(source, 0, 0) || { ...source, content: [] };
  const offsets: number[] = [],
    paragraphOrigins: number[] = [],
    imageStarts: number[] = [],
    pictureSources: { from: number; images: number }[] = [],
    hiddenParagraphs: number[] = [],
    suppressedMarkers: number[] = [];
  const collect = (node: DocNode, noMarker = false) => {
    if (node.type === "paragraph") {
      const index = offsets.length;
      offsets.push(paragraphs.get(node)!);
      paragraphOrigins.push(origins.get(node) ?? -1);
      imageStarts.push(paragraphImages.get(node)!);
      if (hidden.has(node)) hiddenParagraphs.push(index);
      if (noMarker) suppressedMarkers.push(index);
    }
    if (picture(node)) pictureSources.push(pictureOffsets.get(node)!);
    node.content?.forEach((child, index) =>
      collect(child, index === 0 && suppress.has(node)),
    );
  };
  collect(document);
  return {
    document,
    from,
    images,
    offsets,
    paragraphOrigins,
    repeatedParagraphs: [] as number[],
    repeatedPictures: [] as number[],
    imageStarts,
    pictureSources,
    hiddenParagraphs,
    suppressedMarkers,
  };
}
