import type { DocNode } from "./types";
import { documentText } from "./textProjection";
import { continueListedNote } from "./listNoteContinuation";

const picture = (node: DocNode) =>
  ["image", "inline_image"].includes(node.type);

/** Pictures have zero narration length. Retain a separate picture cursor so a
 * continuation at the same text offset cannot repeat or discard a picture. */
export function continueNote(source: DocNode, from: number, images: number) {
  if (
    source.content?.some((node) =>
      ["ordered_list", "bullet_list"].includes(node.type),
    )
  )
    return continueListedNote(source, from, images);
  if (
    source.content?.some(
      (block) =>
        !["paragraph", "image"].includes(block.type) ||
        block.content?.some(
          (child) =>
            !["text", "hard_break", "inline_image"].includes(child.type),
        ),
    )
  )
    throw new Error(
      "A footnote containing lists or tables cannot continue across different page widths yet. Keep the section text widths equal before publishing.",
    );
  let position = 0,
    image = 0;
  let start: { from: number; images: number } | undefined;
  const content: DocNode[] = [];
  for (const block of source.content || []) {
    const blockStart = position,
      length = documentText(block).length;
    if (picture(block)) {
      if (position >= from && image >= images) {
        start ||= { from: position, images: image };
        content.push(block);
      }
      image++;
    } else {
      const children: DocNode[] = [];
      for (const child of block.content || []) {
        if (picture(child)) {
          if (position >= from && image >= images) {
            start ||= { from: position, images: image };
            children.push(child);
          }
          image++;
          continue;
        }
        const size = documentText(child).length;
        if (position + size > from) {
          const skip = Math.max(0, from - position);
          start ||= { from: position + skip, images: image };
          children.push(
            skip && child.type === "text"
              ? { ...child, text: child.text!.slice(skip) }
              : child,
          );
        }
        position += size;
      }
      if (children.length || (!block.content?.length && blockStart >= from)) {
        start ||= { from: blockStart, images: image };
        content.push({
          ...block,
          attrs: {
            ...block.attrs,
            ...(from > blockStart || from === 0
              ? { firstLineIndent: 0, spaceBefore: 0 }
              : {}),
          },
          content: children,
        });
      }
    }
    position = blockStart + length + 1;
  }
  return {
    document: { ...source, content },
    from: start?.from ?? from,
    images: start?.images ?? image,
    offsets: undefined as number[] | undefined,
    paragraphOrigins: undefined as number[] | undefined,
    repeatedParagraphs: [] as number[],
    repeatedPictures: [] as number[],
    imageStarts: undefined as number[] | undefined,
    pictureSources: undefined as { from: number; images: number }[] | undefined,
    hiddenParagraphs: [] as number[],
    suppressedMarkers: [] as number[],
  };
}
