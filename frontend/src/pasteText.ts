import {
  DOMParser,
  Fragment,
  Slice,
  type Node as PMNode,
  type Schema,
} from "prosemirror-model";

export type PasteMode = "source" | "destination" | "plain";

/** Parse only the editor's supported semantic structures; never insert HTML directly. */
export function clipboardSlice(
  schema: Schema,
  text: string,
  html: string,
  mode: PasteMode,
  onWarning?: (message: string) => void,
  availableStyles?: ReadonlySet<string>,
  availableImages?: ReadonlyMap<string, string>,
): Slice {
  if (mode === "plain" || !html) {
    return Slice.maxOpen(
      Fragment.fromArray(
        text
          .replace(/\r\n?/g, "\n")
          .split("\n")
          .map((line) =>
            schema.nodes.paragraph.create(
              null,
              line ? schema.text(line) : undefined,
            ),
          ),
      ),
    );
  }
  // Template content remains inert while sanitising: detached <img> elements in
  // an ordinary div can start network requests before the sanitiser reaches them.
  const container = document.createElement("template");
  container.innerHTML = html;
  const root = container.content;
  root
    .querySelectorAll("script,style,iframe,object,embed,meta,link")
    .forEach((node) => node.remove());
  root.querySelectorAll("[href],[src]").forEach((node) => {
    for (const key of ["href", "src"]) {
      let value = node.getAttribute(key);
      if (key === "src" && value?.startsWith("alder://local/api/projects/")) {
        value = value.slice("alder://local".length);
        node.setAttribute(key, value);
      }
      if (value && !/^(?:https?:|mailto:|#|\/api\/)/i.test(value.trim()))
        node.removeAttribute(key);
    }
  });
  let missingImage = false;
  root.querySelectorAll("img").forEach((node) => {
    const source = node.getAttribute("src") || "";
    const assetId = availableImages?.get(source);
    if (!assetId) {
      node.replaceWith(document.createTextNode(node.alt || "[Image]"));
      missingImage = true;
    } else node.setAttribute("data-asset-id", assetId);
  });
  let missingStyle = false;
  const styleAttrs = (attrs: Record<string, unknown>) => {
    if (
      attrs.styleId &&
      availableStyles &&
      !availableStyles.has(String(attrs.styleId))
    ) {
      missingStyle = true;
      return { ...attrs, styleId: null };
    }
    return attrs;
  };
  const slice = DOMParser.fromSchema(schema).parseSlice(root);
  const clean = (node: PMNode): PMNode => {
    const attrs = styleAttrs({ ...node.attrs });
    if ("blockId" in attrs) attrs.blockId = null;
    if (mode === "destination" && node.isTextblock) {
      for (const key of Object.keys(attrs))
        if (!["level", "blockId"].includes(key)) attrs[key] = null;
    }
    const marks =
      mode === "destination"
        ? node.marks.filter(
            (mark) => !["text_style", "highlight"].includes(mark.type.name),
          )
        : node.marks.map((mark) =>
            mark.type.name === "text_style"
              ? mark.type.create(styleAttrs(mark.attrs))
              : mark,
          );
    return node.isText
      ? node.mark(marks)
      : node.type.create(
          attrs,
          Fragment.fromArray(
            Array.from({ length: node.childCount }, (_, i) =>
              clean(node.child(i)),
            ),
          ),
          marks,
        );
  };
  const result = new Slice(
    Fragment.fromArray(
      Array.from({ length: slice.content.childCount }, (_, i) =>
        clean(slice.content.child(i)),
      ),
    ),
    slice.openStart,
    slice.openEnd,
  );
  const warnings = [
    missingImage
      ? "Some clipboard images could not be collected. Their alternative text was kept; use Insert image to add the files."
      : "",
    missingStyle
      ? "Styles from another document were converted to the available direct formatting."
      : "",
  ].filter(Boolean);
  if (warnings.length) onWarning?.(warnings.join(" "));
  return result;
}
