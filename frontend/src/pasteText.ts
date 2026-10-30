import {
  DOMParser,
  Fragment,
  Slice,
  type Node as PMNode,
  type Schema,
} from "prosemirror-model";
import { copiedBookmarkTargets } from "./documentBookmarks";
import { isRevisionMark, type RevisionStamp } from "./trackedChanges";
import type { FormatLog } from "./trackedFormatting";
import { validateReviewMarkup } from "./reviewMarkup";
import { projectText } from "./textProjection";
import { validCitationItems } from './citationTypes';
import { validBibliography } from './documentCitations';
import type { ParagraphFormatLog } from "./trackedParagraphFormatting";
import {textBoxProperties,validTextBoxContent} from "./textBoxes";
import {validDocumentNote} from './documentNotes';
import {equationProperties,importedMath} from "./equations";
import {formFieldProperties} from './formFields';

export function clipboardText(schema: Schema, slice: Slice) {
  const fragment = slice.content.firstChild?.isInline
    ? Fragment.from(schema.nodes.paragraph.create(null, slice.content))
    : slice.content;
  return projectText(schema.topNodeType.create(null, fragment)).text;
}

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
  validateReviewMarkup(root);
  for(const el of root.querySelectorAll('[data-equation]')) equationProperties(JSON.parse(el.getAttribute('data-equation')!));
  for(const el of root.querySelectorAll('math'))if(!el.closest('[data-equation]'))importedMath(el);
  for(const element of root.querySelectorAll('[data-form-field]')) {
    try { formFieldProperties(JSON.parse(element.getAttribute('data-form-field')!)); }
    catch { throw new Error('The copied form field contains invalid properties. The document was not changed.'); }
  }
  for(const element of root.querySelectorAll('[data-text-box]')) {
    try { textBoxProperties(JSON.parse(element.getAttribute('data-text-box')!)); }
    catch { throw new Error('The copied text box contains invalid properties. The document was not changed.'); }
  }
  for(const element of root.querySelectorAll('[data-document-citation],[data-document-bibliography]')){
    try{const citation=element.hasAttribute('data-document-citation'),value=JSON.parse(element.getAttribute(citation?'data-document-citation':'data-document-bibliography')!);if(!(citation?validCitationItems(value.items):validBibliography(value)))throw new Error();}
    catch{throw new Error('The copied citation contains invalid source metadata. The document was not changed.');}
  }
  for(const element of root.querySelectorAll('[data-document-note]')){
    let value;
    try{value=JSON.parse(element.getAttribute('data-document-note')!);if(!validDocumentNote(value))throw new Error();schema.nodeFromJSON(value.body).check();}
    catch{throw new Error('The copied note contains unsupported or invalid content. The document was not changed.');}
  }
  root
    .querySelectorAll("script,style,iframe,object,embed,meta,link")
    .forEach((node) => node.remove());
  root
    .querySelectorAll(
      'img.ProseMirror-separator,br.ProseMirror-trailingBreak,[data-heading-marker="true"],.heading-number,[data-outline-number="true"],[data-discretionary-hyphen="true"]',
    )
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
    const original = node.getAttribute("data-image-source");
    if (original && availableImages?.has(original))
      node.setAttribute("src", original);
    else node.removeAttribute("data-image-source");
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
  const parsed = DOMParser.fromSchema(schema).parseSlice(root);
  // parseSlice opens every non-leaf ancestor, including atomic inline fields
  // and text boxes. Opening those wrappers pastes only their wording and loses
  // their identity/properties. Only ordinary container edges may merge.
  const openDepth = (last: boolean) => {
    let depth = 0;
    for (let n = last ? parsed.content.lastChild : parsed.content.firstChild;
      n && !n.isLeaf && !n.isAtom; n = last ? n.lastChild : n.firstChild) depth++;
    return depth;
  };
  const slice = new Slice(parsed.content, Math.min(parsed.openStart,openDepth(false)), Math.min(parsed.openEnd,openDepth(true)));
  slice.content.descendants(node=>{
    if(node.type.name === "text_box" && !validTextBoxContent(node.toJSON().content))
      throw new Error('The copied text box contains unsupported content. The document was not changed.');
  });
  const bookmarks = copiedBookmarkTargets(slice.content);
  const revisions = new Map<string, string>(),
    paragraphIds = new Map<string, string>();
  const copiedStamp = (stamp: RevisionStamp) => {
    if (!revisions.has(stamp.id))
      revisions.set(stamp.id, `change_${crypto.randomUUID()}`);
    return { ...stamp, id: revisions.get(stamp.id)! };
  };
  slice.content.descendants((node) => {
    if (
      mode === "destination" &&
      (node.attrs.revisionProperties ||
        node.type.name === "revision_break" ||
        node.marks.some((mark) => mark.type.name.startsWith("revision_")))
    )
      throw new Error(
        "Use Paste with source formatting to retain these pending changes, or Paste plain text for their final wording.",
      );
    if (node.isTextblock && node.attrs.blockId) {
      const id = bookmarks.nodes.get(node) || `block_${crypto.randomUUID()}`;
      bookmarks.nodes.set(node, id);
      paragraphIds.set(node.attrs.blockId, id);
    }
  });
  const comments = new Map<string, string>();
  slice.content.descendants((node) => {
    if (
      node.type.name === "comment_anchor" &&
      !comments.has(node.attrs.threadId)
    )
      comments.set(node.attrs.threadId, `comment_${crypto.randomUUID()}`);
  });
  const clean = (node: PMNode): PMNode | null => {
    const attrs = styleAttrs({ ...node.attrs });
    if(node.type.name==='document_note')attrs.body=clean(schema.nodeFromJSON(node.attrs.body))!.toJSON();
    if (attrs.revisionProperties) {
      const log = attrs.revisionProperties as ParagraphFormatLog;
      attrs.revisionProperties = {
        ...log,
        records: log.records.map((record) => ({
          ...record,
          stamp: copiedStamp(record.stamp),
        })),
      };
    }
    if (node.type.name === "comment_anchor")
      attrs.threadId = comments.get(String(attrs.threadId));
    if (node.type.name === "revision_break") {
      attrs.stamp = copiedStamp(node.attrs.stamp);
      if (attrs.kind === "insertion") {
        if (!paragraphIds.has(String(attrs.nextId)))
          throw new Error(
            "Copy both sides of this pending paragraph break, or review it before copying.",
          );
        attrs.nextId = paragraphIds.get(String(attrs.nextId));
      } else
        attrs.rightAttrs = {
          ...node.attrs.rightAttrs,
          blockId: `block_${crypto.randomUUID()}`,
        };
    }
    if (
      attrs.captionTargetId &&
      bookmarks.links.has(String(attrs.captionTargetId))
    )
      attrs.captionTargetId = bookmarks.links.get(
        String(attrs.captionTargetId),
      );
    if (
      node.type.name === "cross_reference" &&
      bookmarks.links.has(String(attrs.targetId))
    )
      attrs.targetId = bookmarks.links.get(String(attrs.targetId));
    if (node.type.name === "bookmark_end") {
      if (!bookmarks.links.has(String(attrs.targetId))) return null;
      attrs.targetId = bookmarks.links.get(String(attrs.targetId));
    }
    if(node.type.name==='index_reference')attrs.targetIds=node.attrs.targetIds.map((id:string)=>bookmarks.links.get(id)||id);
    if(node.type.name==='index_entry' && attrs.rangeId)attrs.rangeId=bookmarks.links.get(String(attrs.rangeId))||attrs.rangeId;
    if (node.type.name === "bookmark" && attrs.range)
      attrs.range = bookmarks.complete.has(String(attrs.blockId));
    if ("blockId" in attrs) attrs.blockId = bookmarks.nodes.get(node) || null;
    if (mode === "destination" && node.isTextblock) {
      for (const key of Object.keys(attrs))
        if (
          !["level", "blockId", "captionLabel", "captionTargetId"].includes(key)
        )
          attrs[key] = null;
    }
    let marks =
      mode === "destination"
        ? node.marks.filter(
            (mark) => !["text_style", "highlight"].includes(mark.type.name),
          )
        : node.marks.map((mark) =>
            mark.type.name === "text_style"
              ? mark.type.create(styleAttrs(mark.attrs))
              : mark,
          );
    marks = marks.map((mark) =>
      mark.type.name === "link" &&
      mark.attrs.href?.startsWith("#") &&
      bookmarks.links.has(mark.attrs.href.slice(1))
        ? mark.type.create({
            ...mark.attrs,
            href: "#" + bookmarks.links.get(mark.attrs.href.slice(1)),
          })
        : mark,
    );
    marks = marks.map((mark) => {
      if (isRevisionMark(mark.type.name))
        return mark.type.create(copiedStamp(mark.attrs as RevisionStamp));
      if (mark.type.name === "revision_format") {
        const log = mark.attrs as FormatLog;
        return mark.type.create({
          ...log,
          records: log.records.map((record) => ({
            ...record,
            stamp: copiedStamp(record.stamp),
          })),
        });
      }
      return mark;
    });
    return node.isText
      ? node.mark(marks)
      : node.type.create(
          attrs,
          Fragment.fromArray(
            Array.from({ length: node.childCount }, (_, i) =>
              clean(node.child(i)),
            ).filter((node): node is PMNode => !!node),
          ),
          marks,
        );
  };
  const result = new Slice(
    Fragment.fromArray(
      Array.from({ length: slice.content.childCount }, (_, i) =>
        clean(slice.content.child(i)),
      ).filter((node): node is PMNode => !!node),
    ),
    // A caption is a semantic paragraph. An open slice would merge its
    // first line into a destination body paragraph and discard that identity.
    slice.content.firstChild?.attrs.captionLabel ? 0 : slice.openStart,
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
