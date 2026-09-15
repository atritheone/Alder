import MarkdownIt from "markdown-it";
import { defaultMarkdownSerializer } from "prosemirror-markdown";
import { DOMParser as PMParser, DOMSerializer } from "prosemirror-model";
import { schema, parseEditorDocument } from "./Editor";
import type { Chapter, DocNode, RawSource } from "./types";

const markdown = new MarkdownIt({ html: false });
export function sourceForChapter(chapter: Chapter): RawSource {
  if (chapter.rawSource) return chapter.rawSource;
  const parsed = parseEditorDocument(chapter.document);
  if (!parsed.document)
    throw new Error(parsed.error || "Cannot open this document as source.");
  if (chapter.rawFormat === "markdown") {
    try {
      const source: RawSource = {
        format: "markdown",
        text: defaultMarkdownSerializer.serialize(parsed.document),
      };
      // Markdown cannot carry every font, paragraph style or rich structure.
      // Only use it when parsing the source preserves the complete document.
      if (parsed.document.eq(schema.nodeFromJSON(parseRawSource(source))))
        return source;
    } catch {
      /* HTML retains rich structures Markdown cannot represent. */
    }
  }
  const container = document.createElement("div");
  const serializer = DOMSerializer.fromSchema(schema);
  const sourceSerializer = new DOMSerializer(
    {
      ...serializer.nodes,
      image: (node) => [
        "img",
        {
          src: node.attrs.src,
          alt: node.attrs.alt,
          title: node.attrs.title,
          width: node.attrs.width,
          "data-asset-id": node.attrs.assetId,
        },
      ],
    },
    serializer.marks,
  );
  container.append(sourceSerializer.serializeFragment(parsed.document.content));
  return {
    format: "html",
    text: Array.from(container.childNodes)
      .map((node) => (node as HTMLElement).outerHTML || node.textContent)
      .join("\n"),
  };
}

export function parseRawSource(source: RawSource): DocNode {
  const container = document.createElement("div");
  container.innerHTML =
    source.format === "markdown" ? markdown.render(source.text) : source.text;
  const allowed = new Set(
    "p h1 h2 h3 h4 h5 h6 blockquote pre code br hr div img figure strong b em i u s del strike sub sup mark a span ul ol li table tbody thead tfoot tr td th colgroup col".split(
      " ",
    ),
  );
  for (const el of container.querySelectorAll("*")) {
    if (!allowed.has(el.tagName.toLowerCase()))
      throw new Error(
        `Unsupported markup: <${el.tagName.toLowerCase()}>. Your source is kept; correct it before returning to formatted writing.`,
      );
    for (const name of el.getAttributeNames()) {
      if (name.toLowerCase().startsWith("on"))
        throw new Error("Event handlers are not document formatting.");
      if (
        ["href", "src"].includes(name) &&
        /^\s*(javascript|vbscript|data|file):/i.test(
          el.getAttribute(name) || "",
        )
      )
        throw new Error("Use a document asset or a web link for this address.");
    }
  }
  const parsed = PMParser.fromSchema(schema).parse(container, {
    preserveWhitespace: source.format === "html" ? true : false,
  });
  parsed.check();
  return parsed.toJSON();
}

/** One plain paragraph per source line preserves newlines in the paginated editor. */
export function rawTextDocument(text: string): DocNode {
  return {
    type: "doc",
    content: text.split(/\r?\n/).map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : [],
    })),
  };
}
