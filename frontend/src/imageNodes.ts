import type { NodeSpec } from "prosemirror-model";
import { mediaUrl } from "./api";
import { croppedImageSource, cropFromDOM } from "./imageCrop";

/** Both placements share authored properties; only their place in the tree differs. */
export function imageSpec(inline: boolean, portable = false): NodeSpec {
  return {
    inline,
    group: inline ? "inline" : "block",
    draggable: true,
    atom: true,
    attrs: {
      src: { default: "" },
      assetId: { default: null },
      alt: { default: "" },
      decorative: { default: false },
      title: { default: null },
      width: { default: null },
      align: { default: "left" },
      blockId: { default: null },
      crop: { default: null },
    },
    parseDOM: [
      {
        tag: "img[src]",
        getAttrs: (dom) => {
          const block =
            dom.getAttribute("data-image-placement") === "block" ||
            (dom.getAttribute("data-image-placement") !== "inline" &&
              dom.parentElement?.tagName === "FIGURE");
          if (inline === block) return false;
          return {
            blockId: /^[A-Za-z0-9_.-]{1,128}$/.test(
              dom.getAttribute("data-object-id") || "",
            )
              ? dom.getAttribute("data-object-id")
              : null,
            crop: cropFromDOM(dom),
            src: /^\/api\/projects\/[^/?#]+\/assets\/[^/?#]+$/.test(
              dom.getAttribute("data-image-source") || "",
            )
              ? dom.getAttribute("data-image-source")
              : dom.getAttribute("src"),
            assetId: dom.getAttribute("data-asset-id"),
            alt:
              dom.getAttribute("data-image-alt") ||
              dom.getAttribute("alt") ||
              "",
            decorative:
              dom.getAttribute("data-image-decorative") === "true" ||
              dom.getAttribute("role") === "presentation",
            title:
              dom.getAttribute("data-image-title") || dom.getAttribute("title"),
            width: dom.getAttribute("width"),
            align:
              dom.getAttribute("data-image-align") ||
              (block ? dom.parentElement?.style.textAlign : "") ||
              "left",
          };
        },
      },
    ],
    toDOM: (node) => {
      const a = node.attrs;
      const source = croppedImageSource(a.src, a.crop);
      const image: [string, Record<string, unknown>] = [
        "img",
        {
          src: portable
            ? a.src
            : source?.startsWith("/api/")
              ? mediaUrl(source)
              : source,
          "data-object-id": a.blockId,
          "data-image-source": a.src?.startsWith("/api/") ? a.src : null,
          "data-image-crop": a.crop ? JSON.stringify(a.crop) : null,
          alt: a.decorative ? "" : a.alt,
          title: a.decorative ? null : a.title,
          role: a.decorative ? "presentation" : null,
          "data-image-alt": a.decorative ? a.alt : null,
          "data-image-title": a.decorative ? a.title : null,
          "data-image-decorative": a.decorative ? "true" : null,
          "data-image-placement": inline ? "inline" : "block",
          width: a.width,
          style:
            a.width && Number.isFinite(Number(a.width))
              ? `width:${Number(a.width)}px`
              : null,
          "data-asset-id": a.assetId,
          "data-image-align": a.align,
        },
      ];
      return inline
        ? image
        : [
            "figure",
            {
              style:
                "text-align:" +
                (["left", "center", "right"].includes(a.align)
                  ? a.align
                  : "left"),
            },
            image,
          ];
    },
  };
}
