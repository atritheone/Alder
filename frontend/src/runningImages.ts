import type { DocNode } from "./types";
import { mediaUrl } from "./api";
import { croppedImageSource } from "./imageCrop";

const sizes = new Map<string, { width: number; height: number }>();
const pending = new Map<string, Promise<void>>();
export let runningImageVersion = 0;
function source(attrs: Record<string, any>) {
  const value = croppedImageSource(attrs.src || "", attrs.crop);
  return value.startsWith("/api/") ? mediaUrl(value) : value;
}
/** Decode once before measuring stories, including images inside table cells. */
export async function prepareRunningImages(documents: DocNode[]) {
  const sources = new Set<string>();
  const walk = (node: DocNode) => {
    if (["image", "inline_image"].includes(node.type))
      sources.add(source(node.attrs || {}));
    node.content?.forEach(walk);
  };
  documents.forEach(walk);
  await Promise.all(
    [...sources].map((src) => {
      if (sizes.has(src)) return;
      if (!pending.has(src)) {
        const image = new Image();
        image.src = src;
        const promise = image
          .decode()
          .then(() => {
            if (!image.naturalWidth || !image.naturalHeight)
              throw new Error(
                "The header or footer image has no usable dimensions.",
              );
            if (sizes.size >= 256) sizes.delete(sizes.keys().next().value!);
            sizes.set(src, {
              width: image.naturalWidth,
              height: image.naturalHeight,
            });
            runningImageVersion++;
          })
          .catch(() => {
            throw new Error(
              "A header or footer image could not be loaded. Collect or replace the image before applying or printing.",
            );
          })
          .finally(() => pending.delete(src));
        pending.set(src, promise);
      }
      return pending.get(src);
    }),
  );
}
export function paintRunningImageSizes(root: HTMLElement) {
  let ready = true;
  root.querySelectorAll<HTMLImageElement>("img[src]").forEach((image) => {
    const size = sizes.get(image.getAttribute("src") || "");
    if (!size) {
      ready = false;
      return;
    }
    image.style.aspectRatio = `${size.width} / ${size.height}`;
    image.style.width ||= `${size.width}px`;
    image.style.height = "auto";
    image.style.maxWidth = "100%";
  });
  return ready;
}
